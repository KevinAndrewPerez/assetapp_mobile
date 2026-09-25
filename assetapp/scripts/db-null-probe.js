/**
 * READ-ONLY: does the live DB actually allow NULL in columns the Laravel
 * migrations declare NOT NULL? If a row already holds NULL there, the live
 * column is nullable (schema drift) and app writes that omit it are fine.
 */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const db = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);

// [table, columns the migration says are NOT NULL, app write that omits them]
const CHECKS = [
  ['repairs', ['Request_id', 'Approve_by', 'Repair_Cost'], "maintenanceService 'send for repair' (Request_id: null)"],
  ['replacements', ['Request_id', 'new_assets_id', 'reason', 'Approve_by', 'Replacement_Date', 'replacement_reason'], "maintenanceService 'recommend replacement' (no Request_id, new_assets_id: null)"],
  ['disposals', ['Request_id', 'Approve_by', 'Description', 'disposal_date', 'disposal_reason'], 'mobile disposal creation'],
  ['requests', ['user_id', 'request_type'], 'mobile request creation'],
  ['assets', ['user_id', 'Asset_code', 'Asset_name'], 'asset registration'],
  ['asset_files', ['Asset_id', 'file_name', 'file_path', 'file_size', 'mime_type'], 'photo upload'],
  ['pullouts', ['request_id', 'asset_id'], 'pullout creation'],
  ['users', ['employee_numbers_id', 'email', 'password'], 'registration'],
  ['employee_numbers', ['Full_Name', 'Department_id'], 'registration'],
];

(async () => {
  for (const [table, cols, note] of CHECKS) {
    const nulls = [];
    for (const col of cols) {
      const { count, error } = await db.from(table).select(col, { count: 'exact', head: true }).is(col, null);
      if (error) nulls.push(`${col}(error: ${error.message})`);
      else if (count) nulls.push(`${col}=${count} null`);
    }
    console.log(`${nulls.length ? '\u2717' : '\u2713'} ${table}  -- ${note}`);
    if (nulls.length) console.log(`    NULLs found (live column IS nullable): ${nulls.join(', ')}`);
    else console.log('    no NULLs found (consistent with the migration: write that omits it would fail)');
  }
})();
