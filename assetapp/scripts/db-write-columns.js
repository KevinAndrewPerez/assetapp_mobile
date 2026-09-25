/**
 * Static helper: pull the columns each write touches, grouped by table.
 * Reads lib/*.ts only; prints `table: col1, col2, ...`
 */
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'lib');

const out = {};
for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  // find .from('table') ... .insert(...) / .update(...) within the next 400 chars
  const re = /\.from\(\s*['"`](\w+)['"`]\s*\)([\s\S]{0,600}?)\.(insert|update|upsert)\(([\s\S]{0,900}?)\)\s*(?:\.|;|,|\n)/g;
  let m;
  while ((m = re.exec(src))) {
    const [, table, between, kind, body] = m;
    if (/\.select|\.eq|\.in\(/.test(between) && kind !== 'update') continue;
    const keys = new Set();
    // object literal keys: `  foo: x` or `  "Foo_Bar": x`
    for (const k of body.matchAll(/[{,]\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s/g)) {
      const name = k[1];
      if (['id', 'data', 'error', 'count'].includes(name)) continue;
      keys.add(name);
    }
    if (!keys.size) continue;
    out[table] = out[table] || { insert: new Set(), update: new Set() };
    const bucket = kind === 'update' ? out[table].update : out[table].insert;
    keys.forEach((k) => bucket.add(k));
  }
}

for (const [t, v] of Object.entries(out).sort()) {
  console.log(`\n${t}`);
  if (v.insert.size) console.log(`  insert: ${[...v.insert].sort().join(', ')}`);
  if (v.update.size) console.log(`  update: ${[...v.update].sort().join(', ')}`);
}
