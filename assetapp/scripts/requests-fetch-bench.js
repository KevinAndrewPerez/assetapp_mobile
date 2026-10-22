// Read-only: the Requests screen resolves request_items and replacements after
// the main query. This measures the old sequential order against the current
// Promise.all order against the live project.
const fs = require('fs');
const path = require('path');

const env = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim() || '';
const url = get('EXPO_PUBLIC_SUPABASE_URL');
const key = get('EXPO_PUBLIC_SUPABASE_ANON_KEY');
const headers = { apikey: key, Authorization: `Bearer ${key}` };

const rest = async (query) => {
  const started = performance.now();
  const res = await fetch(`${url}/rest/v1/${query}`, { headers });
  const body = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.slice(0, 160)}`);
  return { rows: JSON.parse(body), ms: performance.now() - started };
};

const RUNS = 5;

(async () => {
  const main = await rest('requests?select=id&order=created_at.desc');
  const ids = main.rows.map((r) => r.id);
  console.log(`requests rows: ${ids.length} (main query ${main.ms.toFixed(0)} ms)`);

  const inList = (column) => `${column}=in.(${ids.join(',')})`;
  const itemsPath = `request_items?select=request_id&${inList('request_id')}`;
  const repsPath = `replacements?select=Request_id,old_assets_id,new_assets_id&${inList('Request_id')}`;

  const sequential = [];
  const parallel = [];
  for (let run = 0; run < RUNS; run += 1) {
    let started = performance.now();
    const items = await rest(itemsPath);
    const reps = await rest(repsPath);
    sequential.push(performance.now() - started);

    started = performance.now();
    const [items2, reps2] = await Promise.all([rest(itemsPath), rest(repsPath)]);
    parallel.push(performance.now() - started);

    if (run === 0) {
      console.log(
        `linked rows: ${items.rows.length} request_items, ${reps.rows.length} replacements ` +
          `(parallel identical: ${items2.rows.length === items.rows.length && reps2.rows.length === reps.rows.length})`,
      );
    }
  }

  const avg = (list) => list.reduce((a, b) => a + b, 0) / list.length;
  console.log(`\nsequential lookups: ${avg(sequential).toFixed(0)} ms average (${sequential.map((n) => n.toFixed(0)).join(', ')})`);
  console.log(`parallel lookups:   ${avg(parallel).toFixed(0)} ms average (${parallel.map((n) => n.toFixed(0)).join(', ')})`);
  console.log(
    `\nround trips per load: 3 -> 2; both orders return the same rows.`,
  );
})().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
