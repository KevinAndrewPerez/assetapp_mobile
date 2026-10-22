/**
 * Read-only check of the exact PostgREST reads the Disposal screen and the
 * request detail use. Nothing is written.
 *
 *   node scripts/disposal-screen-probe.js
 */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const supabase = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);

(async () => {
  const { data, error } = await supabase
    .from('requests')
    .select(
      `id, request_type, status, Note, created_at,
       users:user_id (employee_numbers (Full_Name), email, departments:department_id (Name)),
       assets (Asset_code, Asset_name),
       request_items (assets (Asset_code, Asset_name))`,
    )
    .ilike('request_type', 'disposal')
    .order('created_at', { ascending: false });

  console.log('disposal console select:', error ? `ERROR ${error.message}` : `OK (${data.length} rows)`);
  if (!error) {
    for (const row of data) {
      const user = Array.isArray(row.users) ? row.users[0] : row.users;
      const employee = Array.isArray(user?.employee_numbers) ? user.employee_numbers[0] : user?.employee_numbers;
      const department = Array.isArray(user?.departments) ? user.departments[0] : user?.departments;
      const items = (row.request_items ?? [])
        .map((it) => (Array.isArray(it.assets) ? it.assets[0] : it.assets))
        .filter(Boolean)
        .map((a) => a.Asset_code);
      console.log(
        `  #${row.id} ${row.status} · ${employee?.Full_Name ?? user?.email ?? 'unknown'} · ${department?.Name ?? '—'} · items [${items.join(', ')}]`,
      );
    }
  }

  const { data: forms, error: formsError } = await supabase
    .from('disposal_forms')
    .select(
      'id, request_id, status, office_department, expected_disposal_date, method_key, method_code, remarks, approved_reason, prepared_at, ready_at, printed_at, print_count, signed_received_at, signed_file_name, finalized_at, actual_disposal_date, updated_at',
    );
  console.log('\nform select:', formsError ? `ERROR ${formsError.message}` : `OK (${forms.length} rows)`);

  const { data: detail, error: detailError } = await supabase
    .from('requests')
    .select(
      `*, users:user_id(department_id, employee_numbers(Full_Name), departments:department_id(Name)), assets(Asset_code, Asset_name, Lifecycle_Status, asset_files(Asset_file_ID, file_name, file_path, url)), request_items(assets(Asset_code, Asset_name, Lifecycle_Status, asset_files(Asset_file_ID, file_name, file_path, url)))`,
    )
    .ilike('request_type', 'disposal')
    .limit(1)
    .maybeSingle();
  console.log('request detail select:', detailError ? `ERROR ${detailError.message}` : 'OK');
  if (detail && !detailError) {
    console.log('  admin_remarks present:', Object.prototype.hasOwnProperty.call(detail, 'admin_remarks'));
    const linked = (detail.request_items ?? [])
      .map((it) => (Array.isArray(it.assets) ? it.assets[0] : it.assets))
      .filter(Boolean);
    console.log('  linked asset lifecycle:', linked.map((a) => `${a.Asset_code}=${a.Lifecycle_Status}`).join(', '));
  }

  const { count, error: countError } = await supabase
    .from('disposals')
    .select('Disposal_ID', { count: 'exact', head: true });
  console.log('\nfinalized record count:', countError ? `ERROR ${countError.message}` : count);

  const { data: pending, error: pendingError } = await supabase
    .from('requests')
    .select('id, Note, request_items(asset_id)')
    .ilike('request_type', 'disposal')
    .ilike('status', 'pending');
  console.log('pending disposal requests:', pendingError ? `ERROR ${pendingError.message}` : pending.length);

  // Concurrency token, read-only: does the `updated_at` string the app loads
  // match exactly one row when used as a filter (which is what the guarded
  // UPDATE does)? A wrong token must match zero.
  const sample = (forms ?? [])[0];
  if (sample && !formsError) {
    const { data: exact } = await supabase
      .from('disposal_forms')
      .select('id')
      .eq('id', sample.id)
      .eq('updated_at', sample.updated_at);
    const { data: stale } = await supabase
      .from('disposal_forms')
      .select('id')
      .eq('id', sample.id)
      .eq('updated_at', '1900-01-01T00:00:00');
    console.log(
      `form #${sample.id} token matches: exact=${exact.length}, wrong=${stale.length} (want 1 and 0)`,
    );
  }
})();
