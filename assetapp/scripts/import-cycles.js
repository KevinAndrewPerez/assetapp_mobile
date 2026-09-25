/**
 * Static check for Metro's "Require cycle" warnings.
 *
 * Walks every .ts/.tsx file under app/, lib/ and components/, resolves relative
 * imports (plus the @/ alias) and reports any circular chain.
 *
 *   node scripts/import-cycles.js
 */
const fs = require('fs');
const path = require('path');

const ROOTS = ['lib', 'app', 'components'];
const BASE = path.join(__dirname, '..');

const files = [];
const walk = (dir) => {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (/\.tsx?$/.test(entry.name)) files.push(p);
  }
};
for (const root of ROOTS) walk(path.join(BASE, root));

const resolveImport = (fromFile, spec) => {
  let target;
  if (spec.startsWith('@/')) target = path.join(BASE, spec.slice(2));
  else if (spec.startsWith('.')) target = path.resolve(path.dirname(fromFile), spec);
  else return null;

  for (const candidate of [
    `${target}.ts`,
    `${target}.tsx`,
    path.join(target, 'index.ts'),
    path.join(target, 'index.tsx'),
  ]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
};

const graph = new Map();
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const deps = new Set();
  const importRe = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g;
  let match;
  while ((match = importRe.exec(source))) {
    const resolved = resolveImport(file, match[1]);
    if (resolved) deps.add(resolved);
  }
  graph.set(file, [...deps]);
}

const cycles = [];
const state = new Map();
const stack = [];
const rel = (f) => path.relative(BASE, f).replace(/\\/g, '/');

const visit = (file) => {
  state.set(file, 'visiting');
  stack.push(file);
  for (const dep of graph.get(file) ?? []) {
    if (state.get(dep) === 'visiting') {
      cycles.push([...stack.slice(stack.indexOf(dep)), dep].map(rel).join(' -> '));
    } else if (!state.has(dep)) {
      visit(dep);
    }
  }
  stack.pop();
  state.set(file, 'done');
};

for (const file of files) if (!state.has(file)) visit(file);

const unique = [...new Set(cycles)];
if (unique.length === 0) {
  console.log('No circular imports found.');
} else {
  console.log(`${unique.length} circular import(s):\n`);
  unique.forEach((chain) => console.log(`  WARN  Require cycle: ${chain}\n`));
}
