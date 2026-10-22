/**
 * Read-only view of disposal requests and their forms/records, used to check
 * the mobile parity work against real data.
 *
 *   node scripts/disposal-request-probe.js
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

const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
);

(async () => {
  const { data: requests, error } = await supabase
    .from('requests')
    .select('id, request_type, status, Note, user_id, created_at')
    .ilike('request_type', 'disposal')
    .order('id', { ascending: false });

  if (error) {
    console.error(error);
    return;
  }

  const { data: forms } = await supabase
    .from('disposal_forms')
    .select('id, request_id, status, approved_reason, method_key, expected_disposal_date, finalized_at');
  const formByRequest = new Map((forms ?? []).map((f) => [String(f.request_id), f]));

  const { data: items } = await supabase.from('request_items').select('request_id, asset_id');
  const itemsByRequest = new Map();
  (items ?? []).forEach((row) => {
    const list = itemsByRequest.get(String(row.request_id)) ?? [];
    list.push(row.asset_id);
    itemsByRequest.set(String(row.request_id), list);
  });

  const { data: disposals } = await supabase
    .from('disposals')
    .select('Disposal_ID, Asset_id, Request_id, disposal_reason')
    .not('Request_id', 'is', null);
  const disposalsByRequest = new Map();
  (disposals ?? []).forEach((row) => {
    const list = disposalsByRequest.get(String(row.Request_id)) ?? [];
    list.push(row);
    disposalsByRequest.set(String(row.Request_id), list);
  });

  console.log(`disposal requests: ${requests.length}\n`);
  for (const r of requests) {
    const form = formByRequest.get(String(r.id));
    const linked = itemsByRequest.get(String(r.id)) ?? [];
    const records = disposalsByRequest.get(String(r.id)) ?? [];
    console.log(
      `#${r.id} ${String(r.status).padEnd(9)} form=${form ? `${form.status}${form.finalized_at ? ' (finalized)' : ''}` : 'none'}` +
        ` assets=[${linked.join(',')}] records=${records.length}`,
    );
    console.log(`   note: ${String(r.Note ?? '').slice(0, 90)}`);
  }
})();
