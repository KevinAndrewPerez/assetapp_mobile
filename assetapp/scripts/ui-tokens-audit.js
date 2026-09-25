/**
 * Read-only UI audit: tallies the button / chip / pill style variants used
 * across `app/` and `components/` so mismatched sizes are visible at a glance.
 *
 *   node scripts/ui-tokens-audit.js
 */
const fs = require('fs');
const path = require('path');

const files = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (/\.tsx$/.test(entry.name)) files.push(p);
  }
};
walk('app');
walk('components');

const tallies = new Map();
for (const file of files) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const starts = [];
  lines.forEach((line, i) => {
    const m = /^ {2}([A-Za-z0-9_]+):\s*\{$/.exec(line);
    if (m) starts.push({ name: m[1], line: i });
  });
  for (let k = 0; k < starts.length; k++) {
    const { name, line } = starts[k];
    if (!/(Button|Btn|Chip|Send|Action|Primary|Secondary|Ghost|Pill|Fab)/.test(name)) continue;
    // Shadow offsets also contain `height:` — they are not element sizing.
    const body = lines
      .slice(line, k + 1 < starts.length ? starts[k + 1].line : lines.length)
      .filter((l) => !/shadowOffset/.test(l))
      .join('\n');
    const h = /(?<![a-zA-Z])height:\s*([0-9.]+)/.exec(body);
    const pv = /(?<![a-zA-Z])paddingVertical:\s*([0-9.]+)/.exec(body);
    const r = /borderRadius:\s*([0-9.]+)/.exec(body);
    const fsz = /fontSize:\s*([0-9.]+)/.exec(body);
    const fw = /fontWeight:\s*'([0-9a-z]+)'/.exec(body);
    if (!h && !pv) continue;
    const key = [h ? `h${h[1]}` : `pv${pv ? pv[1] : '?'}`, r ? `r${r[1]}` : 'r?', fsz ? `f${fsz[1]}` : '-', fw ? `w${fw[1]}` : '-'].join(' | ');
    if (!tallies.has(key)) tallies.set(key, []);
    tallies.get(key).push(`${file.split(path.sep).join('/').replace(/^app\//, 'a/')}:${name}`);
  }
}

const rows = [...tallies.entries()].sort((a, b) => b[1].length - a[1].length);
for (const [key, where] of rows) {
  console.log(String(where.length).padStart(3), key.padEnd(34), 'e.g.', where.slice(0, 4).join(', '));
}
console.log('total button/chip style blocks:', rows.reduce((sum, [, v]) => sum + v.length, 0));
