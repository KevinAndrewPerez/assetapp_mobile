#!/usr/bin/env node
/**
 * Storage doctor — the mobile app's answer to the web app's `php artisan media:doctor`.
 *
 * Photos only ever land in Supabase Storage, and the app talks to it with the
 * publishable key, so nothing here needs (or may use) a service-role key.
 *
 *   node scripts/storage-doctor.js                       # read-only diagnosis
 *   node scripts/storage-doctor.js --write               # also prove the app can upload
 *   node scripts/storage-doctor.js --check=<object key>  # fetch one real object
 *
 * Exit code is 1 when something is definitely broken, so it can gate a build.
 *
 * `--write` uploads one tiny probe per folder the app writes to. Probes are
 * deleted automatically when SUPABASE_SERVICE_ROLE_KEY is present in the shell
 * only; the publishable key cannot delete (there is no DELETE policy), so
 * without it the script prints the keys to remove in the dashboard.
 */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : '';
};

/** The whole project keeps ONE bucket; everything else is a folder inside it. */
const BUCKET = 'assets';
/** Every folder the app writes to, with the code that writes it. */
const WRITE_TARGETS = [
  { folder: 'assets/', writtenBy: 'asset-registry bulk/single registration' },
  { folder: 'photos/', writtenBy: 'lib/assetService.ts uploadAssetPhoto' },
  { folder: 'profile_photos/', writtenBy: 'lib/userService.ts uploadProfilePhoto' },
  { folder: 'request_files/', writtenBy: 'lib/userService.ts uploadRequestPhoto' },
  { folder: 'assets/qr/', writtenBy: 'web app Media::generateQr' },
];

let failures = 0;
const ok = (label, detail = '') => console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`);
const warn = (label, detail = '') => console.log(`  warn ${label}${detail ? ` — ${detail}` : ''}`);
const fail = (label, detail = '') => {
  failures += 1;
  console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
};

const decodeKey = (raw) => {
  try {
    return JSON.parse(Buffer.from(String(raw).split('.')[1], 'base64').toString('utf8'));
  } catch {
    return null;
  }
};

const describeKey = (raw) => {
  if (!raw) return 'missing';
  if (!String(raw).startsWith('eyJ')) return `publishable key (length ${String(raw).length})`;
  const payload = decodeKey(raw);
  return payload
    ? `JWT role "${payload.role || '?'}" for project "${payload.ref || '?'}"`
    : 'JWT (could not be decoded)';
};

/** Same .env loader every other scripts/*.js probe uses. */
const loadEnv = () => {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return false;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return true;
};

const diagnoseConfig = (url, key, envFound) => {
  console.log('== configuration ==');
  if (!envFound) {
    fail('.env', `not found at ${path.join(ROOT, '.env')} (Expo reads the EXPO_PUBLIC_* keys from there)`);
  }
  if (!url || !key) {
    fail('EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY', 'missing from .env and app.json extra');
    return;
  }
  ok('supabase url', url);
  ok('key', describeKey(key));

  const ref = (url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co$/i) || [])[1];
  ref ? ok('project ref', ref) : warn('project url', 'not a *.supabase.co host');

  const payload = String(key).startsWith('eyJ') ? decodeKey(key) : null;
  if (payload && payload.ref && ref && payload.ref !== ref) {
    fail('key belongs to another project', `the key signs "${payload.ref}", the URL points at "${ref}"`);
  }
};

/** Any `storage.from('x')` where x is not the single bucket can never work. */
const diagnoseBucketNames = () => {
  console.log(`\n== bucket ==\n  ${BUCKET} (single bucket; every folder below lives inside it)`);
  console.log('\n== storage.from() names used in lib/ ==');
  let seen = 0;
  for (const file of fs.readdirSync(path.join(ROOT, 'lib')).filter((f) => /\.tsx?$/.test(f))) {
    const body = fs.readFileSync(path.join(ROOT, 'lib', file), 'utf8');
    for (const m of body.matchAll(/storage\.from\(\s*(['"`])([^'"`]+)\1\s*\)/g)) {
      seen += 1;
      const name = m[2];
      name === BUCKET
        ? ok(`lib/${file}: from('${name}')`)
        : fail(
            `lib/${file}: from('${name}')`,
            `there is no bucket called "${name}" — use '${BUCKET}' with a "${name}/" key`,
          );
    }
  }
  if (!seen) warn('no storage.from() calls found in lib/');
};

const proveWrites = async (client) => {
  console.log('\n== can the app write? (--write) ==');
  const probes = [];
  for (const target of WRITE_TARGETS) {
    const objectKey = `${target.folder}_doctor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`;
    const { error } = await client.storage
      .from(BUCKET)
      .upload(objectKey, Buffer.from('storage-doctor'), { contentType: 'text/plain', upsert: false });

    if (error) {
      fail(target.folder, `${error.message} (${target.writtenBy})`);
      continue;
    }
    probes.push(objectKey);

    const { data } = client.storage.from(BUCKET).getPublicUrl(objectKey);
    const response = data && data.publicUrl ? await fetch(data.publicUrl) : null;
    response && response.ok
      ? ok(target.folder, `upload + public read work (${target.writtenBy})`)
      : fail(target.folder, `uploaded, but the public URL answered ${response ? response.status : 'nothing'}`);
  }
  return probes;
};

const cleanUp = async (url, probes) => {
  if (!probes.length) return;
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
  if (!serviceKey) {
    warn(
      'probes were left in the bucket',
      'the publishable key has no DELETE policy. Remove these in the dashboard, or re-run with '
        + 'SUPABASE_SERVICE_ROLE_KEY in the shell for this one process:\n    '
        + probes.map((p) => `'${p}'`).join(' '),
    );
    return;
  }
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { error } = await admin.storage.from(BUCKET).remove(probes);
  error ? warn('probe cleanup', error.message) : ok('probe cleanup', `${probes.length} object(s) deleted`);
};

const checkStoredObject = async (client, objectKey) => {
  console.log('\n== stored object ==');
  const { data } = client.storage.from(BUCKET).getPublicUrl(objectKey.replace(/^\/+/, ''));
  const publicUrl = data && data.publicUrl;
  const response = publicUrl ? await fetch(publicUrl) : null;
  if (!response || !response.ok) {
    fail(objectKey, `${publicUrl || 'no url'} answered ${response ? response.status : 'nothing'}`);
    return;
  }
  ok(objectKey, `HTTP ${response.status}`);
};

async function main() {
  const envFound = loadEnv();
  const url = String(process.env.EXPO_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
  const key = String(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '');

  diagnoseConfig(url, key, envFound);
  diagnoseBucketNames();

  const client = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;

  if (!has('--write')) {
    console.log(
      '\n== writes ==\n  skipped (pass --write to prove uploads; it leaves probe objects behind '
        + 'unless SUPABASE_SERVICE_ROLE_KEY is set in the shell)',
    );
  } else if (!client) {
    fail('--write', 'no client: the Supabase url/key are missing');
  } else {
    await cleanUp(url, await proveWrites(client));
  }

  const objectKey = valueOf('check');
  if (!objectKey) {
    console.log(
      '\n== stored objects ==\n  skipped (pass --check=<object key from file_path / qr_code_path, '
        + 'e.g. assets/qr/AST-1-17.png>)',
    );
  } else if (!client) {
    fail(objectKey, 'no client: the Supabase url/key are missing');
  } else {
    await checkStoredObject(client, objectKey);
  }

  console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} check(s) failed`}`);
  // Set the code instead of calling process.exit(): a hard exit with fetch
  // sockets still open trips a libuv assertion on Windows.
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(`! storage-doctor crashed: ${error && error.message ? error.message : error}`);
  process.exitCode = 1;
});
