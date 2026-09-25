/** Probe one column at a time so a missing column can't hide behind others. */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const db = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);

const CANDIDATES = {
  departments: ['id', 'Department_id', 'Name', 'status', 'created_at', 'updated_at'],
  users: ['id', 'email', 'password', 'role', 'status', 'department_id', 'employee_numbers_id', 'profile_photo', 'created_at', 'updated_at'],
  employee_numbers: ['id', 'Full_Name', 'Employee_number', 'Department_id', 'status', 'created_at', 'updated_at'],
  pullouts: ['id', 'request_id', 'asset_id', 'status', 'Description', 'notes', 'pullout_date', 'destination', 'expected_return_date', 'Approve_by', 'created_at', 'updated_at'],
  assets: ['id', 'user_id', 'Asset_code', 'Asset_name', 'Category', 'Condition', 'Lifecycle_Status', 'accusion_date', 'purchase_Price', 'warranty_months', 'lifespan_months', 'maintenance_interval', 'expiration_date', 'next_maintenance_date', 'last_maintenance_date', 'supplier', 'model', 'manufacture', 'serial_Number', 'asset_location', 'repair_counts', 'created_at', 'updated_at'],
  repairs: ['Repair_id', 'Assets_id', 'Request_id', 'Repair_Description', 'Repair_Date', 'Approve_by', 'Repair_Cost', 'status', 'Repair_result', 'notes', 'created_at', 'updated_at'],
  repair_evaluations: ['evaluation_id', 'repair_id', 'technician_provider', 'repair_cost', 'repair_result', 'expected_completion', 'parts_replaced', 'inspection_findings', 'admin_remarks', 'recorded_by', 'created_at', 'updated_at'],
  disposals: ['Disposal_ID', 'Asset_id', 'Request_id', 'Approve_by', 'Description', 'disposal_reason', 'disposal_date', 'notes', 'created_at', 'updated_at'],
  replacements: ['Replacement_id', 'Request_id', 'old_assets_id', 'new_assets_id', 'Approve_by', 'reason', 'replacement_reason', 'notes', 'Replacement_Date', 'status', 'created_at', 'updated_at'],
  requests: ['id', 'user_id', 'asset_id', 'request_type', 'status', 'Note', 'assign_to_user_id', 'file_name', 'file_path', 'file_size', 'mime_type', 'url', 'created_at', 'updated_at'],
  request_items: ['id', 'request_id', 'asset_id', 'created_at', 'updated_at'],
  pullout_items: ['id', 'pullout_id', 'asset_id', 'created_at', 'updated_at'],
  asset_files: ['Asset_file_ID', 'Asset_id', 'file_name', 'file_path', 'file_size', 'mime_type', 'url', 'uploaded_at', 'created_at', 'updated_at'],
  notifications: ['id', 'user_id', 'title', 'message', 'type', 'reference_id', 'reference_type', 'is_read', 'created_at', 'updated_at'],
  audit_logs: ['id', 'user_id', 'asset_id', 'request_id', 'notes', 'action_type', 'action_description', 'created_at', 'updated_at'],
};

(async () => {
  for (const [t, cols] of Object.entries(CANDIDATES)) {
    const missing = [];
    for (const c of cols) {
      const { error } = await db.from(t).select(c, { count: 'exact', head: true });
      if (error) missing.push(c);
    }
    console.log(missing.length ? `\u2717 ${t}: MISSING -> ${missing.join(', ')}` : `\u2713 ${t}: all ${cols.length} columns exist`);
  }
})();
