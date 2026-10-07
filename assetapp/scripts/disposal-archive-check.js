/**
 * Does the app's "Archive & remove from inventory" request actually work against
 * the live database?
 *
 *   node scripts/disposal-archive-check.js
 *
 * The green button on Disposal Records runs:
 *   1. `archiveColumnsReady()`  → select is_archived
 *   2. the archive UPDATE       → patch disposals?Disposal_ID=eq.…&or=(is_archived…)
 *   3. `removeAssetFromInventory()` for the linked asset
 *
 * It uses a throwaway disposal row (no asset, so nothing else is touched), so the
 * real records on the Disposal page are left exactly as they are. Whatever this
 * prints is what the button would get: a 200 with no row means the row was
 * already archived (the app then says so), and a 401/403 means the write is
 * blocked by permissions.
 */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

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

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok });
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

const stamp = () => new Date().toISOString();

(async () => {
  console.log('Archive request, against the live database\n');

  // ---- 1. the probe the button makes before it does anything ---------------
  const probe = await supabase.from('disposals').select('is_archived').limit(1);
  check(
    'readiness probe: disposals.is_archived is readable',
    !probe.error,
    probe.error?.message ?? '',
  );

  // ---- 2. a throwaway row, written the way the app writes one --------------
  const { data: inserted, error: insertError } = await supabase
    .from('disposals')
    .insert([
      {
        Asset_id: null, // no asset → the inventory half is a no-op for the probe
        Request_id: null,
        Approve_by: 'archive-check',
        Description: 'archive request check — safe to delete',
        disposal_reason: 'Obsolete',
        disposal_date: stamp().slice(0, 10),
        notes: 'Status: Approved | Origin: Manual',
        created_at: stamp(),
        updated_at: stamp(),
      },
    ])
    .select('Disposal_ID')
    .single();
  check('throwaway disposal row created', !insertError && !!inserted, insertError?.message ?? '');
  if (insertError || !inserted) {
    console.log('\nCannot continue without a probe row.');
    process.exitCode = 1;
    return;
  }
  const disposalId = String(inserted.Disposal_ID);
  console.log(`  probe Disposal_ID: ${disposalId}`);

  const archivePayload = {
    is_archived: true,
    archived_at: stamp(),
    archived_by: null,
    updated_at: stamp(),
  };

  // ---- 3. the exact UPDATE the button runs ---------------------------------
  const first = await supabase
    .from('disposals')
    .update(archivePayload)
    .eq('Disposal_ID', disposalId)
    .or('is_archived.eq.false,is_archived.is.null')
    .select('Disposal_ID');
  check(
    'archive UPDATE matched the row (a 200 with one row = archived)',
    !first.error && (first.data ?? []).length === 1,
    first.error?.message ?? `rows=${(first.data ?? []).length}`,
  );

  // ---- 4. what a second tap would get --------------------------------------
  const second = await supabase
    .from('disposals')
    .update(archivePayload)
    .eq('Disposal_ID', disposalId)
    .or('is_archived.eq.false,is_archived.is.null')
    .select('Disposal_ID');
  check(
    'second attempt matches nothing (app then says "already archived")',
    !second.error && (second.data ?? []).length === 0,
    second.error?.message ?? `rows=${(second.data ?? []).length}`,
  );

  // ---- 5. the row really reads back archived ------------------------------
  const { data: readBack } = await supabase
    .from('disposals')
    .select('Disposal_ID, is_archived, archived_at')
    .eq('Disposal_ID', disposalId)
    .maybeSingle();
  check(
    'archived flag reads back true',
    Boolean(readBack?.is_archived),
    JSON.stringify(readBack ?? {}),
  );

  // ---- 6. how the two shelves split --------------------------------------
  const { data: activeRows } = await supabase.from('disposals').select('Disposal_ID, is_archived');
  const active = (activeRows ?? []).filter((r) => !r.is_archived).length;
  const archived = (activeRows ?? []).filter((r) => r.is_archived).length;
  console.log(`  shelves with the probe in place: Disposal (${active}) / Archived (${archived})`);

  // ---- cleanup ------------------------------------------------------------
  const { error: deleteError } = await supabase
    .from('disposals')
    .delete()
    .eq('Disposal_ID', disposalId);
  const { data: left } = await supabase
    .from('disposals')
    .select('Disposal_ID')
    .eq('Disposal_ID', disposalId);
  check('probe row deleted again', !deleteError && (left ?? []).length === 0, deleteError?.message ?? '');

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n${failed.length === 0 ? 'OK' : 'FAILED'}: ${results.length - failed.length}/${results.length} checks passed`,
  );
  if (failed.length) process.exitCode = 1;
})().catch((err) => {
  console.error('\nCheck crashed:', err.message);
  process.exitCode = 1;
});
