// Read-only: compares the department asset list query with and without the
// per-asset photo embed, and proves the lazy photo lookup returns the same URL.
const fs = require('fs');
const path = require('path');

const env = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim() || '';
const url = get('EXPO_PUBLIC_SUPABASE_URL');
const key = get('EXPO_PUBLIC_SUPABASE_ANON_KEY');
const headers = { apikey: key, Authorization: `Bearer ${key}` };

const CUSTODIAN =
  'users!assets_user_id_foreign(department_id, employee_numbers("Full_Name"), departments(id, "Name"))';
const FILES = 'asset_files("Asset_file_ID", file_name, file_path, url, mime_type)';

const run = async (label, select) => {
  const started = performance.now();
  const res = await fetch(
    `${url}/rest/v1/assets?select=${encodeURIComponent(select)}&order=updated_at.desc`,
    { headers },
  );
  const body = await res.text();
  const ms = performance.now() - started;
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status} ${body.slice(0, 200)}`);
  const rows = JSON.parse(body);
  const files = rows.reduce((n, row) => n + (Array.isArray(row.asset_files) ? row.asset_files.length : 0), 0);
  console.log(
    `${label.padEnd(24)} ${String(rows.length).padStart(4)} assets  ${String(
      (body.length / 1024).toFixed(1),
    ).padStart(8)} KiB  ${files} file rows  ${ms.toFixed(0)} ms`,
  );
  return rows;
};

(async () => {
  const full = await run('with asset_files', `*, ${CUSTODIAN}, ${FILES}`);
  const light = await run('without asset_files', `*, ${CUSTODIAN}`);
  const fullBytes = Buffer.byteLength(JSON.stringify(full));
  const lightBytes = Buffer.byteLength(JSON.stringify(light));
  console.log(
    `\npayload change: ${((1 - lightBytes / fullBytes) * 100).toFixed(1)}% smaller ` +
      `(${(fullBytes / 1024).toFixed(1)} KiB → ${(lightBytes / 1024).toFixed(1)} KiB)`,
  );

  // The lazy lookup a card performs when it is expanded must still find a photo
  // for the assets that have one.
  const withPhoto = full.find((row) => Array.isArray(row.asset_files) && row.asset_files.length > 0);
  if (!withPhoto) {
    console.log('\nNo asset currently has a photo — nothing to lazy-load, lookup skipped.');
    return;
  }
  const res = await fetch(
    `${url}/rest/v1/assets?select=${encodeURIComponent(FILES)}&id=eq.${withPhoto.id}`,
    { headers },
  );
  const [row] = await res.json();
  const same = JSON.stringify(row?.asset_files) === JSON.stringify(withPhoto.asset_files);
  console.log(
    `\nlazy photo lookup for asset ${withPhoto.id}: ${res.status}, ${
      Array.isArray(row?.asset_files) ? row.asset_files.length : 0
    } file row(s), ${same ? 'matches the embedded rows' : 'DIFFERS from the embedded rows'}`,
  );
})().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
