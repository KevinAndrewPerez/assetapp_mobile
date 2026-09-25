/**
 * READ-ONLY: list the distinct values each enum-like column actually holds,
 * next to the values the Laravel migrations allow. Any app-written value that
 * is NOT in the migration list would be rejected by the DB.
 */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const db = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);

// allowed values straight from NUTrace/database/migrations
const ALLOWED = {
  'assets.Category': ['Furnitures and Fixtures', 'General and Office Equipment', 'Info and Equipment', 'laboratory Apparatus and equipment', 'library books', 'Motor vehicles', 'P.E Equipment', 'Low value Asset'],
  'assets.Condition': ['New', 'Excellent', 'Good', 'Fair', 'Existing'],
  'assets.Lifecycle_Status': ['Acquired', 'Active', 'For Repair', 'For Checking', 'For Replacement', 'Pullout', 'Disposal'],
  'requests.request_type': ['Repair', 'Disposal', 'Transfer', 'Replacement', 'Pullout', 'Other'],
  'requests.status': ['Pending', 'Approved', 'Rejected'],
  'repairs.status': ['Pending', 'In Progress', 'Completed', 'Cancelled'],
  'repairs.Repair_result': ['Repairable', 'Beyond Repair', 'For Replacement'],
  'pullouts.status': null, // added later in-app (text column)
  'replacements.status': ['Pending', 'Approved', 'Ordered', 'Received', 'Complete', 'Cancelled'],
  'replacements.replacement_reason': ['Beyond Repair', 'Obsolete', 'End of Lifespan', 'Lost', 'Damage'],
  'disposals.disposal_reason': ['Beyond Repair', 'Replace', 'Obsolete', 'Lost', 'Damage'],
  'audit_logs.action_type': ['CREATE', 'UPDATE', 'REPAIR', 'REPLACEMENT', 'DISPOSAL', 'TRANSFER', 'LOGIN', 'APPROVAL'],
  'users.role': ['Admin', 'Employee', 'Department Head', 'Facilities'],
  'users.status': ['Active', 'Inactive'],
};

(async () => {
  for (const ref of Object.keys(ALLOWED)) {
    const [table, col] = ref.split('.');
    const seen = new Set();
    let from = 0;
    for (;;) {
      const { data, error } = await db.from(table).select(col).range(from, from + 999);
      if (error) { console.log(`\n## ${ref}\n   ERROR: ${error.message}`); break; }
      (data || []).forEach((r) => seen.add(String(r[col])));
      if (!data || data.length < 1000) break;
      from += 1000;
    }
    const allowed = ALLOWED[ref];
    const vals = [...seen].sort();
    const bad = allowed ? vals.filter((v) => !allowed.includes(v)) : [];
    console.log(`\n## ${ref}  (${vals.length} distinct)`);
    console.log(`   in DB : ${vals.join(' | ') || '(none)'}`);
    console.log(`   allowed: ${allowed ? allowed.join(' | ') : '(free text - no enum)'}`);
    if (bad.length) console.log(`   \u2717 VALUES IN DB THAT THE MIGRATION ENUM DOES NOT ALLOW: ${bad.join(' | ')}`);
  }
})();
