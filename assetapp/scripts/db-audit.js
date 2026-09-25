/**
 * READ-ONLY database audit for assetapp_mobile.
 *
 *   node scripts/db-audit.js
 *
 * It does NOT insert, update or delete anything. It only:
 *   1. counts rows in every table the app talks to
 *   2. validates every column the app selects (catches renamed/missing columns)
 *   3. runs each real query shape the services use (catches broken joins / RLS)
 *
 * Run it whenever a screen shows wrong/empty data.
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
const db = createClient(url, key);

let failures = 0;
const bad = (label, err) => {
  failures++;
  const e = err && typeof err === 'object' ? err : { message: String(err) };
  console.log(
    `  \u2717 ${label}\n      ${e.code ? `[${e.code}] ` : ''}${e.message || JSON.stringify(e)}` +
    `${e.details ? `\n      details: ${typeof e.details === 'string' ? e.details : JSON.stringify(e.details)}` : ''}` +
    `${e.hint ? `\n      hint: ${e.hint}` : ''}`,
  );
};

// ---- 1. row counts ---------------------------------------------------------
const TABLES = [
  'users', 'employee_numbers', 'departments', 'assets', 'asset_files',
  'requests', 'request_items', 'repairs', 'repair_evaluations',
  'pullouts', 'pullout_items', 'disposals',  'replacements',
  'notifications', 'audit_logs', 'asset_accountability',
];

// ---- 2. columns the app reads, per table ----------------------------------
const COLUMNS = {
  users: 'id, email, role, status, department_id, employee_numbers_id, profile_photo, created_at, updated_at',
  employee_numbers: 'id, Full_Name, Employee_number, Department_id',
  departments: 'id, Name, status',
  assets: 'id, Asset_code, Asset_name, Category, Condition, Lifecycle_Status, serial_Number, asset_location, purchase_Price, warranty_months, lifespan_months, expiration_date, maintenance_interval, last_maintenance_date, next_maintenance_date, qr_code_path, user_id, accusion_date, model, manufacture, supplier, repair_counts, created_at, updated_at',
  asset_files: 'Asset_file_ID, Asset_id, file_name, file_path, file_size, mime_type, url, uploaded_at, created_at, updated_at',
  requests: 'id, user_id, asset_id, request_type, status, Note, file_name, file_path, file_size, mime_type, url, assign_to_user_id, created_at, updated_at',
  request_items: 'id, request_id, asset_id, created_at, updated_at',
  repairs: 'Repair_id, Assets_id, Request_id, Repair_Description, Repair_Date, Approve_by, Repair_Cost, status, Repair_result, notes, created_at, updated_at',
  repair_evaluations: 'evaluation_id, repair_id, technician_provider, repair_cost, repair_result, expected_completion, parts_replaced, inspection_findings, admin_remarks, recorded_by, created_at, updated_at',
  pullouts: 'id, request_id, asset_id, status, Description, notes, pullout_date, destination, expected_return_date, Approve_by, created_at, updated_at',
  pullout_items: 'id, pullout_id, asset_id, created_at, updated_at',
  disposals: 'Disposal_ID, Asset_id, Request_id, Approve_by, Description, disposal_reason, disposal_date, notes, created_at, updated_at',
  replacements: 'Replacement_id, Request_id, old_assets_id, new_assets_id, Approve_by, reason, replacement_reason, notes, Replacement_Date, status, created_at, updated_at',
  notifications: 'id, user_id, title, message, type, reference_id, reference_type, is_read, created_at, updated_at',
  audit_logs: 'id, user_id, asset_id, request_id, notes, action_type, action_description, created_at, updated_at',
};

// ---- 2b. columns the app WRITES (insert/update payloads) ------------------
const WRITE_COLUMNS = {
  users: 'email, password, role, status, department_id, employee_numbers_id, created_at, updated_at',
  employee_numbers: 'Full_Name, Employee_number, Department_id, status, created_at, updated_at',
  // departments is read-only in the app, and its table has no timestamps.
  departments: 'id, Name, status',
  assets: 'user_id, Asset_code, Asset_name, Category, Condition, Lifecycle_Status, accusion_date, purchase_Price, warranty_months, lifespan_months, maintenance_interval, expiration_date, next_maintenance_date, last_maintenance_date, supplier, model, manufacture, serial_Number, asset_location, repair_counts, created_at, updated_at',
  asset_files: 'Asset_id, file_name, file_path, file_size, mime_type, uploaded_at, url, created_at, updated_at',
  requests: 'user_id, asset_id, request_type, status, Note, assign_to_user_id, file_name, file_path, file_size, mime_type, url, created_at, updated_at',
  request_items: 'request_id, asset_id, created_at, updated_at',
  repairs: 'Assets_id, Request_id, Repair_Description, Repair_Date, Approve_by, Repair_Cost, status, Repair_result, notes, created_at, updated_at',
  repair_evaluations: 'repair_id, technician_provider, repair_cost, repair_result, expected_completion, parts_replaced, inspection_findings, admin_remarks, recorded_by, created_at, updated_at',
  pullouts: 'request_id, asset_id, status, Description, notes, pullout_date, destination, expected_return_date, Approve_by, created_at, updated_at',
  pullout_items: 'pullout_id, asset_id, created_at, updated_at',
  disposals: 'Asset_id, Request_id, Approve_by, Description, disposal_reason, disposal_date, notes, created_at, updated_at',
  replacements: 'Request_id, old_assets_id, new_assets_id, Approve_by, reason, replacement_reason, notes, Replacement_Date, status, created_at, updated_at',
  notifications: 'user_id, title, message, type, reference_id, reference_type, is_read, created_at, updated_at',
  audit_logs: 'user_id, asset_id, request_id, notes, action_type, action_description, created_at, updated_at',
};

// every status value the app can write into these columns (check-constraint risk)
const STATUS_WRITES = {
  'users.status': ['Active', 'Inactive'],
  'employee_numbers.status': ['Active', 'Inactive'],
  'departments.status': ['Active', 'Inactive'],
  'assets.Lifecycle_Status': ['Acquired', 'Active', 'Pullout', 'Repair', 'Maintenance', 'For Disposal', 'Disposed', 'Replaced', 'Expired', 'Lost'],
  'requests.status': ['Pending', 'Approved', 'Rejected'],
  'repairs.status': ['Pending', 'In Progress', 'Completed', 'Cancelled'],
  'repairs.Repair_result': ['Repairable', 'Beyond Repair', 'For Replacement', 'Repaired'],
  'pullouts.status': ['Pending', 'Approved', 'Rejected', 'Completed', 'Cancelled', 'In Progress'],
  'replacements.status': ['Pending', 'Approved', 'Rejected', 'Completed', 'Received'],
};

// ---- 3. real query shapes the services run --------------------------------
const QUERIES = [
  ['assetService  getAssets (full record + joins)', 'assets', '*, users(department_id, employee_numbers("Full_Name"), departments(id, "Name")), asset_files("Asset_file_ID", file_name, file_path, url, mime_type)'],
  ['assetService  asset detail (single)', 'assets', '*, users(department_id, employee_numbers("Full_Name"), departments(id, "Name")), asset_files("Asset_file_ID", file_name, file_path, url, mime_type)'],
  ['assetService  registry lookup', 'assets', 'id, Asset_code, Asset_name, user_id, Category, asset_location, supplier, model, manufacture'],
  ['assetService  replacements for asset', 'replacements', 'Replacement_id, Request_id, old_assets_id, new_assets_id, status, reason, notes, Replacement_Date, created_at'],
  ['maintenanceService  alerts', 'assets', 'id, Asset_code, Asset_name, Lifecycle_Status, maintenance_interval, next_maintenance_date, last_maintenance_date, users:user_id(id, employee_numbers("Full_Name"))'],
  ['maintenanceService  lifespan list', 'assets', 'id, Assets_id:id, Asset_code, Asset_name, Lifecycle_Status, expiration_date, lifespan_months, repair_counts'],
  ['userService  list users', 'users', '*, employee_numbers("Full_Name", "Department_id", "Employee_number"), departments:department_id("Name")'],
  ['userService  current user profile', 'users', 'id, email, department_id, role, status, profile_photo, created_at, updated_at, employee_numbers("Full_Name", "Department_id", "Employee_number"), departments:department_id("Name")'],
  ['userService  my requests', 'requests', 'id, request_type, status, Note, created_at, users:user_id(department_id, employee_numbers(Full_Name)), assets(Asset_code, Asset_name, asset_files(Asset_file_ID, file_name, file_path, url)), request_items(assets(Asset_code, Asset_name, asset_files(Asset_file_ID, file_name, file_path, url)))'],
  ['assetService  lifecycle/activity \u2014 audit lane', 'audit_logs', '*, assets("Asset_name", "Asset_code"), users(role, employee_numbers("Full_Name")), requests(id, request_type)'],
  ['assetService  lifecycle \u2014 repairs lane', 'repairs', '*, assets("Asset_name", "Asset_code"), requests(id, request_type)'],
  ['assetService  lifecycle \u2014 replacements lane', 'replacements', '*, old_assets:old_assets_id(Asset_name, Asset_code), requests(id, request_type)'],
  ['assetService  lifecycle \u2014 disposals lane', 'disposals', '*, assets(Asset_name, Asset_code), requests(id, request_type)'],
  ['userService  my asset files', 'asset_files', '"Asset_file_ID", "Asset_id", file_name, file_path, url, mime_type'],
  ['userService  directory', 'users', 'id, email, employee_numbers(Full_Name, Employee_number), departments(Name)'],
  ['userService  request detail (admin decision)', 'requests', '*, assets(Asset_code, Asset_name)'],
  ['userService  requests per asset', 'requests', 'id, user_id, asset_id, request_type, assign_to_user_id'],
  ['pulloutService  pullout + asset', 'pullout_items', 'asset_id, pullouts(status)'],
  ['pulloutService  pullout detail', 'pullouts', 'id, asset_id, status, notes'],
  ['pulloutService  approvers', 'users', 'id, email, employee_numbers (Full_Name)'],
  ['repairService  repair list', 'repair_evaluations', '*'],
  ['repairService  repairs (admin)', 'repairs', 'Repair_id, Assets_id, Request_id, status, notes'],
  ['repairService  repair detail sync', 'repairs', 'Repair_id, Assets_id, Request_id, status, Repair_result, Repair_Cost, notes'],
  ['repairService  requests for asset', 'requests', 'id, user_id, Note, status, created_at'],
  ['disposalService  disposals (admin)', 'disposals', 'Disposal_ID, Asset_id, Request_id, notes, Description, disposal_reason, disposal_date'],
  ['disposalService  disposal requests', 'requests', 'id, asset_id, Note, user_id, request_type'],
  ['disposalService  approvers', 'users', 'id, email, employee_numbers (Full_Name)'],
  ['notificationService  my notifications', 'notifications', '*'],
  ['notificationService  admins', 'users', 'id, role'],
  ['auditService  audit trail', 'audit_logs', '*'],
  ['transferService  employee list', 'users', 'id, email, role, status, department_id, employee_numbers_id, employee_numbers("Full_Name", "Employee_number", "Department_id", departments("Name"))'],
  ['transferService  asset owner counts', 'assets', 'id, user_id'],
  ['transferService  transfer requests', 'requests', 'id, user_id, assign_to_user_id, status, request_type, created_at'],
  ['transferService  transfer plan items', 'request_items', 'request_id, asset_id'],
  ['transferService  transfer history header', 'requests', 'id, user_id, assign_to_user_id, request_type, status, Note, created_at, admin_remarks, admin_remarks_by'],
  ['transferService  accountability history', 'asset_accountability', 'id, asset_id, user_id, request_id, Is_Current, Assign_date, transfer_reason'],
  ['assetRegistry  duplicate asset-code lookup', 'assets', 'Asset_code'],
  ['requestService  in-flight request for asset', 'requests', 'id, user_id, asset_id, request_type, assign_to_user_id'],
];

(async () => {
  console.log(`\nNUTrace mobile DB audit \u2014 ${url}\n`);

  console.log('== ROW COUNTS ==');
  const counts = {};
  for (const t of TABLES) {
    const { count, error } = await db.from(t).select('*', { count: 'exact', head: true });
    if (error) { bad(`${t}`, error); counts[t] = '-'; }
    else { counts[t] = count; console.log(`  ${String(count).padStart(6)}  ${t}`); }
  }

  console.log('\n== COLUMNS ==');
  const missing = {};
  for (const [t, cols] of Object.entries(COLUMNS)) {
    const { error } = await db.from(t).select(cols, { count: 'exact', head: true });
    if (error) {
      missing[t] = true;
      bad(`${t}(${cols})`, error);
    }
  }
  if (!Object.keys(missing).length) console.log('  \u2713 every column the app selects exists');

  console.log('\n== WRITE COLUMNS ==');
  let writeColFailure = false;
  for (const [t, cols] of Object.entries(WRITE_COLUMNS)) {
    const { error } = await db.from(t).select(cols, { count: 'exact', head: true });
    if (error) { writeColFailure = true; bad(`${t} write payload`, error); }
  }
  if (!writeColFailure) console.log('  \u2713 every column the app writes exists');

  console.log('\n== QUERY SHAPES ==');
  for (const [label, table, cols] of QUERIES) {
    const { data, error } = await db.from(table).select(cols).limit(1);
    if (error) bad(`${label} \u2192 ${table}`, error);
    else console.log(`  \u2713 ${label}${data && data[0] ? '' : '  (0 rows)'}`);
  }

  console.log('\n== CHECK CONSTRAINTS ==');
  console.log('  Not probeable with an anon key: PostgREST evaluates a CHECK only on a write, so');
  console.log('  a read-only script can never confirm one. Run this SQL in the Supabase SQL editor');
  console.log('  to dump them, then compare with scripts/db-values.js / db-literal-audit.js:');
  console.log("    select c.conrelid::regclass as table, c.conname, pg_get_constraintdef(c.oid)\n" +
              "    from pg_constraint c where c.contype = 'c' order by 1, 2;");
  // Column existence for the status/reason columns the app writes is still checked.
  for (const ref of Object.keys(STATUS_WRITES)) {
    const [t, col] = ref.split('.');
    const { error } = await db.from(t).select(col, { count: 'exact', head: true });
    if (error) bad(`${ref} (column missing)`, error);
  }

  console.log(`\n${failures === 0 ? '\u2713 no database errors' : `\u2717 ${failures} issue(s) found`}\n`);
  console.log(JSON.stringify(counts));
})();
