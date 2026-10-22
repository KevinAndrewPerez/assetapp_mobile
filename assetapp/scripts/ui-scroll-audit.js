/**
 * Read-only audit for the tall-chip layout bug: a horizontal ScrollView whose
 * content container has no cross-axis alignment stretches every chip to the
 * scroller's height, and an unconstrained scroller inside a vertical ScrollView
 * grows into the leftover viewport. On the Transfer screen that turned the
 * department filters into full-height ovals.
 *
 * A horizontal scroller is safe when either
 *   - its own style has `flexGrow: 0`, or
 *   - its content container has `alignItems: 'center'`.
 *
 * Run: node scripts/ui-scroll-audit.js
 */
const fs = require('fs');
const path = require('path');

const collect = (dir, acc = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full, acc);
    else if (entry.name.endsWith('.tsx')) acc.push(full);
  }
  return acc;
};

const styleBlock = (source, name) => {
  const start = source.indexOf(`  ${name}: {`);
  if (start < 0) return '';
  const end = source.indexOf('\n  },', start);
  return source.slice(start, end < 0 ? start + 400 : end);
};

let checked = 0;
let unguarded = 0;

for (const file of [...collect('app'), ...collect('components')]) {
  const source = fs.readFileSync(file, 'utf8');

  for (const tag of source.matchAll(/<ScrollView([\s\S]*?)>/g)) {
    if (!/\bhorizontal\b/.test(tag[1])) continue;
    checked += 1;

    const names = [...tag[1].matchAll(/styles\.([A-Za-z0-9_]+)/g)].map((m) => m[1]);
    const guarded = names.some((name) => {
      const block = styleBlock(source, name);
      return /flexGrow:\s*0/.test(block) || /alignItems:\s*['"]center['"]/.test(block);
    });

    if (!guarded) {
      const line = source.slice(0, tag.index).split(/\r?\n/).length;
      console.log(`${file.split(path.sep).join('/')}:${line}  ${names.map((n) => `styles.${n}`).join(' + ')}`);
      unguarded += 1;
    }
  }
}

console.log(
  `\n${checked} horizontal scroll view(s) checked; ${unguarded} without a stretch guard.`,
);
if (unguarded > 0) process.exit(1);
