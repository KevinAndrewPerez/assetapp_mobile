/**
 * READ-ONLY: a real Postgres `enum` type casts in the WHERE clause, so filtering
 * by a non-existent label errors. A `varchar + CHECK` column silently matches 0
 * rows. Either way an out-of-range WRITE is rejected — this just shows which
 * mechanism each column uses.
 */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const db = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);

const COLS = [
  ['audit_logs', 'action_type'],
  ['assets', 'Lifecycle_Status'],
  ['assets', 'Category'],
  ['assets', 'Condition'],
  ['requests', 'request_type'],
  ['requests', 'status'],
  ['repairs', 'status'],
  ['repairs', 'Repair_result'],
  ['replacements', 'status'],
  ['replacements', 'replacement_reason'],
  ['disposals', 'disposal_reason'],
  ['users', 'role'],
];

(async () => {
  for (const [t, c] of COLS) {
    const { error } = await db.from(t).select(c, { count: 'exact', head: true }).eq(c, 'ZZZ_NOT_A_VALUE');
    console.log(
      error
        ? `enum TYPE  ${t}.${c}  -> invalid value is rejected by the cast: ${error.message.slice(0, 70)}`
        : `text+CHECK ${t}.${c}  -> filter accepted (write-time CHECK only)`,
    );
  }
})();
