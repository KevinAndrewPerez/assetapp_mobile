/**
 * Does the reset-code row the app writes match what both apps read?
 *
 *   node scripts/reset-code-store-check.js
 *
 * The app now mails its own code, so IT writes the `password_resets` row the
 * web app wrote before. Two things have to line up or a correct code is refused:
 *
 *   1. the timestamp convention — the column is `timestamp without time zone`
 *      holding UTC, and `parseStoredTimestamp()` in the app appends the missing
 *      zone while Laravel's verifier reads it as UTC too;
 *   2. the hash — bcrypt(12) written as `$2y$…` so Laravel's `Hash::check` and
 *      the app's bcryptjs comparison both accept it.
 *
 * This writes a probe row through the same REST API the app uses, reads it back
 * through the app's query shape, checks both points and deletes it again.
 */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');

// ---- load .env -------------------------------------------------------------
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY in .env');
  process.exit(1);
}
const supabase = createClient(url, key);

const PROBE_EMAIL = 'probe-reset-code@example.invalid';
const TTL_MINUTES = 15;
const CODE = '604213';

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok });
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

/** What `storeResetCode()` writes. */
const storedTimestamp = (value) => value.toISOString().replace(/\.\d{3}Z$/, '').replace('T', ' ');

/** What `parseStoredTimestamp()` reads: a bare string is UTC, not local time. */
const parseStoredTimestamp = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(raw);
  const parsed = new Date(hasZone ? raw : `${raw.replace(' ', 'T')}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

(async () => {
  console.log('Reset-code row contract\n');

  await supabase.from('password_resets').delete().eq('email', PROBE_EMAIL);

  const now = new Date();
  const expires = new Date(now.getTime() + TTL_MINUTES * 60_000);
  const digest = await bcrypt.hash(CODE, 12);
  const token = digest.replace(/^\$2[ab]\$/, '$2y$');

  check('hash is written as $2y$ (Laravel + pgcrypto form)', /^\$2y\$12\$/.test(token), token.slice(0, 7));
  check('hash is 60 characters', token.length === 60, String(token.length));

  const { error: insertError } = await supabase.from('password_resets').insert({
    email: PROBE_EMAIL,
    token,
    expires_at: storedTimestamp(expires),
    used: false,
    created_at: storedTimestamp(now),
    updated_at: storedTimestamp(now),
  });
  check('INSERT through the app REST client', !insertError, insertError?.message ?? '');

  const { data, error } = await supabase
    .from('password_resets')
    .select('id, token, used, expires_at')
    .eq('email', PROBE_EMAIL)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  check('SELECT the newest row (the query the app uses)', !error && !!data, error?.message ?? '');

  const row = data || {};
  const expiry = parseStoredTimestamp(row.expires_at);
  check(
    'expiry reads back as the UTC instant that was written',
    !!expiry && Math.abs(expiry.getTime() - expires.getTime()) < 1500,
    `${row.expires_at} -> ${expiry ? expiry.toISOString() : '(unparsable)'}`,
  );
  check('a fresh code is not expired', !!expiry && expiry.getTime() > Date.now());
  check('the stored value matches the code (bcryptjs)', await bcrypt.compare(CODE, row.token));
  check('the stored value rejects another code', !(await bcrypt.compare('000000', row.token)));
  check('used flag round-trips as false', row.used === false || Number(row.used) === 0, String(row.used));

  await supabase.from('password_resets').delete().eq('email', PROBE_EMAIL);
  const { data: left } = await supabase
    .from('password_resets')
    .select('id')
    .eq('email', PROBE_EMAIL);
  check('probe row cleaned up', (left ?? []).length === 0);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length === 0 ? 'OK' : 'FAILED'}: ${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exitCode = 1;
})().catch((err) => {
  console.error('\nCheck crashed:', err.message);
  process.exitCode = 1;
});
