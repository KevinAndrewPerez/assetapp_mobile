/**
 * Read-only probe: do the official disposal-form tables exist on the live
 * database, and what do their rows look like?
 *
 *   node scripts/disposal-form-probe.js
 *
 * Nothing is written. It answers three questions the mobile implementation
 * depends on: the table exists, the column names the web uses are the ones the
 * phone reads, and whether any form is currently attached to a request.
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

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY in .env');
  process.exit(1);
}
const supabase = createClient(url, key);

(async () => {
  for (const table of ['disposal_forms', 'disposal_form_items']) {
    const { data, error } = await supabase.from(table).select('*').limit(3);
    if (error) {
      console.log(`${table}: ERROR ${error.code ?? ''} ${error.message}`);
      continue;
    }
    console.log(`${table}: OK, ${data.length} sample row(s)`);
    for (const row of data) {
      const picked = {};
      for (const [k, v] of Object.entries(row)) {
        picked[k] = typeof v === 'string' && v.length > 60 ? `${v.slice(0, 60)}…` : v;
      }
      console.log(JSON.stringify(picked, null, 2));
    }
  }

  // Requests already carrying a form, and the stage distribution.
  const { data: forms, error: formsError } = await supabase
    .from('disposal_forms')
    .select('id, request_id, status');
  if (!formsError) {
    console.log(`\nforms total: ${forms.length}`);
    const byStage = {};
    forms.forEach((f) => {
      byStage[f.status] = (byStage[f.status] ?? 0) + 1;
    });
    console.log('by stage:', byStage);
    console.log('example request ids:', forms.slice(0, 5).map((f) => f.request_id));
  }
})();
