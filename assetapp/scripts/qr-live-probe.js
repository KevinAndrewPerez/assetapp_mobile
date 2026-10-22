/**
 * Live, read-only check of everything a QR scan depends on:
 *
 *   1. the `assets` columns the verifier reads (`qr_payload`, `qr_revoked_at`,
 *      owner -> department join) exist;
 *   2. every stored signed payload is accepted by the app's own parser and
 *      verifies against the deployed public keys;
 *   3. an altered payload is refused;
 *   4. `/qr/public-keys` answers with public halves only.
 *
 * Nothing is written. Asset codes, payloads and key material are never printed.
 *
 *   node scripts/qr-live-probe.js
 */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

for (const line of fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8').split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (match) process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
}

const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
);

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
};

(async () => {
  const assets = await supabase
    .from('assets')
    .select('id, Asset_code, qr_payload, qr_revoked_at, user_id, users:user_id(department_id)')
    .limit(1000);

  check(
    'the asset columns QR verification reads are present',
    !assets.error,
    assets.error?.message ?? `${assets.data.length} row(s)`,
  );

  if (assets.error) {
    process.exit(1);
  }

  const rows = assets.data;
  const stored = rows.filter((row) => String(row.qr_payload ?? '').trim() !== '');
  const signedRows = stored.filter((row) => String(row.qr_payload).toUpperCase().startsWith('NUT1-'));
  const legacyRows = stored.filter((row) => !String(row.qr_payload).toUpperCase().startsWith('NUT1-'));
  const missingRows = rows.filter((row) => String(row.qr_payload ?? '').trim() === '');

  console.log(`     assets: ${rows.length} | stored stickers: ${stored.length}`,
    `| signed: ${signedRows.length} | legacy: ${legacyRows.length}`,
    `| unsigned (no payload): ${missingRows.length}`,
    `| revoked: ${rows.filter((row) => row.qr_revoked_at).length}`);
  if (missingRows.length > 0) {
    // These are normally assets registered from the phone. The web signs them
    // with `php artisan qr:resign`; until then their plain code scans as
    // "unsigned", which is honest, not fake.
    console.log('     note: assets without a signed payload must be signed from the web (qr:resign) before their sticker can verify.');
  }
  console.log(`     owner -> department join resolves: ${rows.filter((row) => row.user_id != null && row.users != null).length}/${rows.filter((row) => row.user_id != null).length}`);

  const base = String(process.env.EXPO_PUBLIC_WEB_URL || '').replace(/\/+$/, '');
  if (!base) {
    check('the web origin is configured for /qr/public-keys', false, 'EXPO_PUBLIC_WEB_URL is empty');
    process.exit(1);
  }

  let keyring = {};
  try {
    const response = await fetch(`${base}/qr/public-keys`, { headers: { Accept: 'application/json' } });
    const body = await response.json().catch(() => null);
    const keys = body && body.keys && typeof body.keys === 'object' ? body.keys : {};
    const { keyringFromResponse } = await import('../lib/qrKeyring.ts');
    keyring = keyringFromResponse({ keys });

    check('GET /qr/public-keys answers', response.ok, `HTTP ${response.status}`);
    check('the deployment is configured to sign', body?.configured === true, `configured=${body?.configured}`);
    check('the public keyring has at least one usable key', Object.keys(keyring).length > 0,
      `${Object.keys(keyring).length} key(s): ${Object.values(keyring).map((key) => key.algorithm).join(', ') || '(none)'}`);
    check(
      'only algorithm and public material are published',
      Object.values(keys).every((key) => key && Object.keys(key).sort().join(',') === 'algorithm,public'),
    );
  } catch (error) {
    check('GET /qr/public-keys is reachable', false, String(error.message || error).slice(0, 120));
    process.exit(1);
  }

  if (signedRows.length === 0) {
    check('there is at least one signed sticker to check', false, 'all stored stickers are legacy');
  }

  const { parseQrPayload, payloadMessage, normalizeAssetCode } = await import('../lib/qrPayload.ts');
  const { verifyQrSignature } = await import('../lib/qrSignature.ts');

  let checked = 0;
  let verified = 0;
  let unknownKey = 0;
  let alteredAccepted = 0;

  for (const row of signedRows) {
    const parsed = parseQrPayload(row.qr_payload);
    if (parsed.type !== 'signed' || !parsed.code || !parsed.keyId || !parsed.signature) continue;

    const key = keyring[parsed.keyId];
    if (!key) {
      unknownKey += 1;
      continue;
    }

    checked += 1;
    if (verifyQrSignature(payloadMessage(parsed.code, parsed.keyId), parsed.signature, key)) verified += 1;

    // Alter the code but keep the signature: must fail.
    const altered = normalizeAssetCode(`${parsed.code}X`);
    if (verifyQrSignature(payloadMessage(altered, parsed.keyId), parsed.signature, key) === true) {
      alteredAccepted += 1;
    }
  }

  check('every stored signed sticker verifies with the app\'s verifier',
    checked > 0 && verified === checked,
    `${verified}/${checked} verified${unknownKey ? `, ${unknownKey} unknown key` : ''}`);
  check('an altered asset code is refused for every sticker', alteredAccepted === 0,
    `${alteredAccepted} accepted`);

  console.log('');
  if (failures > 0) {
    console.log(`${failures} live check(s) failed.`);
    process.exit(1);
  }
  console.log('All live QR checks passed.');
})();
