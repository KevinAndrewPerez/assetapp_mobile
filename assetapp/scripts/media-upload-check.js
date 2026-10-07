#!/usr/bin/env node
/**
 * Verification for the mobile upload pipeline.
 *
 *   node scripts/media-upload-check.js          # pure helpers only (fast, offline)
 *   node scripts/media-upload-check.js --live   # also prove both HTTP transports
 *
 * The pure half compiles `lib/mediaUploadCore.ts` with the project's own
 * TypeScript and runs it in Node, so the byte decoder and the object-key
 * builders are checked against Node's Buffer rather than trusted.
 *
 * The live half repeats the two raw-HTTP fallbacks that `lib/mediaUpload.ts`
 * uses when the Supabase client's upload fails on a device, with real binary
 * bytes, and downloads the object back to prove the bytes survived.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(os.tmpdir(), 'nutrace-media-core-check');
const args = process.argv.slice(2);
const live = args.includes('--live');

let failures = 0;
const ok = (label, detail = '') => console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`);
const fail = (label, detail = '') => {
  failures += 1;
  console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
};
const check = (label, actual, expected) => {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  same ? ok(label, JSON.stringify(actual)) : fail(label, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
};

/** Compile the pure core and load it. */
const loadCore = () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  // Run the project's own compiler through node — `npx.cmd` cannot be spawned
  // without a shell on Windows.
  execFileSync(
    process.execPath,
    [
      path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'),
      'lib/mediaUploadCore.ts',
      '--outDir', OUT,
      '--module', 'commonjs',
      '--target', 'es2020',
      '--skipLibCheck',
      '--ignoreConfig',
    ],
    { cwd: ROOT, stdio: 'inherit' },
  );
  const emitted = path.join(OUT, 'mediaUploadCore.js');
  if (!fs.existsSync(emitted)) throw new Error(`tsc did not emit ${emitted}`);
  return require(emitted);
};

const checkPure = (core) => {
  console.log('== base64 → bytes (checked against Buffer) ==');
  const payload = Buffer.from(
    Array.from({ length: 300 }, (_, index) => (index * 37) % 256),
  );
  const base64 = payload.toString('base64');
  const decoded = Buffer.from(core.base64ToBytes(base64));
  check('0..255-wide binary payload round-trips', decoded.equals(payload), true);
  check('empty string decodes to nothing', core.base64ToBytes('').length, 0);
  check('padding is ignored', Array.from(core.base64ToBytes('AQIDBA==')), [1, 2, 3, 4]);
  check('newlines are ignored', Array.from(core.base64ToBytes('AQID\nBA==')).length, 4);
  check('data: prefix is stripped', Array.from(core.base64ToBytes('data:image/png;base64,AQID')), [1, 2, 3]);

  console.log('\n== extension + content type ==');
  check('picker file name wins', core.extensionFor({ uri: 'file:///cache/x', fileName: 'shot.PNG' }), 'png');
  check('uri extension used when no name', core.extensionFor({ uri: 'file:///cache/photo.jpeg?t=1' }), 'jpeg');
  check('content:// uri falls back to the MIME type', core.extensionFor({ uri: 'content://media/1234', mimeType: 'image/webp' }), 'webp');
  check('content:// uri with nothing to go on → jpg', core.extensionFor({ uri: 'content://media/1234' }), 'jpg');
  check('plain uri strings still work', core.extensionFor('file:///a/b.heic'), 'heic');
  check('content type from extension', core.contentTypeFor({ uri: 'file:///a/b.png' }), 'image/png');
  check('content type from MIME', core.contentTypeFor({ uri: 'content://x', mimeType: 'image/jpg; charset=binary' }), 'image/jpeg');
  check('unknown extension → jpeg', core.contentTypeFor({ uri: 'content://x' }), 'image/jpeg');

  console.log('\n== object keys ==');
  check('asset code + timestamp', core.buildObjectKey('photos', 'AST-042', { uri: 'a.jpg' }, 1789373457957), 'photos/AST-042_1789373457957.jpg');
  check('hostile code is sanitised', core.buildObjectKey('photos', 'IT / Room #3?', { uri: 'a.png' }, 1), 'photos/IT-Room-3_1.png');
  check('empty prefix still yields a key', core.buildObjectKey('photos', '', { uri: 'a.jpg' }, 1), 'photos/asset_1.jpg');
  check('folder slashes are trimmed', core.buildObjectKey('/profile_photos/', 7, { uri: 'a.jpg' }, 5), 'profile_photos/7_5.jpg');
  check('key length stays bounded', core.sanitizeKeySegment('x'.repeat(500)).length, 60);
  check('file name of a key', core.fileNameOf('photos/a_1.jpg'), 'a_1.jpg');

  console.log('\n== user-facing messages ==');
  check('bucket message', /does not exist/.test(core.describeUploadError(new Error('Bucket not found'))), true);
  check('RLS message', /permission denied/.test(core.describeUploadError({ message: 'new row violates row-level security policy', statusCode: '403' })), true);
  check('network message', /could not reach/.test(core.describeUploadError(new Error('Network request failed'))), true);
  check('unknown errors keep their text', core.describeUploadError(new Error('weird thing')), 'weird thing');
  check('byte formatting', [core.formatBytes(0), core.formatBytes(512), core.formatBytes(2048), core.formatBytes(3 * 1024 * 1024)], ['0 KB', '512 B', '2 KB', '3.0 MB']);
};

const loadEnv = () => {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return false;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return true;
};

/** The same binary round-trip test as the pure half, for the live transports. */
const checkLive = async () => {
  console.log('\n== live transports (proves the device fallbacks are real) ==');
  loadEnv();
  const url = String(process.env.EXPO_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
  const key = String(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '');
  if (!url || !key) {
    fail('live check', 'EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY missing from .env');
    return;
  }

  const db = createClient(url, key, { auth: { persistSession: false } });
  // 2 KB of non-UTF8 bytes: a text round-trip would corrupt this.
  const bytes = Uint8Array.from({ length: 2048 }, (_, index) => (index * 131 + 7) % 256);
  const objectUrl = (objectKey) => `${url}/storage/v1/object/assets/${objectKey}`;
  const stamp = Date.now();

  const transports = [
    {
      name: 'rest-fetch (ArrayBuffer body)',
      run: (objectKey) =>
        fetch(objectUrl(objectKey), {
          method: 'POST',
          headers: {
            apikey: key,
            authorization: `Bearer ${key}`,
            'content-type': 'image/png',
            'cache-control': 'max-age=3600',
            'x-upsert': 'false',
          },
          body: bytes,
        }),
    },
    {
      name: 'rest-form (multipart Blob)',
      run: (objectKey) => {
        const form = new FormData();
        form.append('cacheControl', '3600');
        form.append('', new Blob([bytes], { type: 'image/png' }), 'probe.png');
        return fetch(objectUrl(objectKey), {
          method: 'POST',
          headers: { apikey: key, authorization: `Bearer ${key}`, 'x-upsert': 'false' },
          body: form,
        });
      },
    },
    {
      name: 'x-upsert: true (must be refused by this bucket)',
      expectFailure: true,
      run: (objectKey) =>
        fetch(objectUrl(objectKey), {
          method: 'POST',
          headers: {
            apikey: key,
            authorization: `Bearer ${key}`,
            'content-type': 'image/png',
            'x-upsert': 'true',
          },
          body: bytes,
        }),
    },
  ];

  for (const transport of transports) {
    const slug = transport.name.replace(/[^a-z]+/gi, '-').toLowerCase();
    const objectKey = `photos/_check-${stamp}-${slug}.png`;
    try {
      const response = await transport.run(objectKey);

      // The bucket grants INSERT but no UPDATE: this documents that an upsert
      // is refused, so the app knows to retry under a new key instead.
      if (transport.expectFailure) {
        const body = await response.text();
        /violates row-level security|Unauthorized/.test(body)
          ? ok(transport.name, `refused as expected (${response.status})`)
          : fail(transport.name, `expected a refusal, got ${response.status} ${body.slice(0, 120)}`);
        continue;
      }

      if (!response.ok) {
        fail(transport.name, `upload answered ${response.status} ${(await response.text()).slice(0, 160)}`);
        continue;
      }
      const publicUrl = db.storage.from('assets').getPublicUrl(objectKey).data.publicUrl;
      const downloaded = await fetch(publicUrl);
      if (!downloaded.ok) {
        fail(transport.name, `public URL answered ${downloaded.status}`);
        continue;
      }
      const roundTripped = Buffer.from(await downloaded.arrayBuffer());
      const same = roundTripped.equals(Buffer.from(bytes));
      same
        ? ok(transport.name, `${objectKey} uploaded + read back byte-identical (${roundTripped.length} bytes)`)
        : fail(transport.name, 'bytes changed in storage');
    } catch (error) {
      fail(transport.name, error.message);
    }
  }
};

(async () => {
  const core = loadCore();
  checkPure(core);
  if (live) {
    await checkLive();
  } else {
    console.log('\n== live transports ==\n  skipped (pass --live to exercise them against the real bucket)');
  }
  console.log(`\n${failures === 0 ? 'all media checks passed' : `${failures} check(s) failed`}`);
  process.exitCode = failures === 0 ? 0 : 1;
})().catch((error) => {
  console.error(`! media check crashed: ${error?.message || error}`);
  process.exitCode = 1;
});
