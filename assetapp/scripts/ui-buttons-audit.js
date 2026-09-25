/**
 * Read-only audit: finds buttons (TouchableOpacity) that render an icon **and**
 * a label but whose style does not lay them out in a row — those render the
 * icon above the text inside a fixed height, which clips the label.
 */
const fs = require('fs');
const path = require('path');

const collect = (dir, acc = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) collect(p, acc);
    else if (/\.tsx$/.test(e.name)) acc.push(p);
  }
  return acc;
};

let flagged = 0;
for (const file of [...collect('app'), ...collect('components')]) {
  const src = fs.readFileSync(file, 'utf8');
  const lineOf = (index) => src.slice(0, index).split(/\r?\n/).length;

  // `  name: { ... },` blocks in the file's StyleSheet.
  const styles = new Map();
  const re = /^ {2}([A-Za-z0-9_]+): \{([\s\S]*?)^ {2}\},?$/gm;
  let m;
  while ((m = re.exec(src))) styles.set(m[1], m[2]);

  // Every TouchableOpacity whose body has an icon and a Text.
  const touchRe = /<TouchableOpacity([\s\S]*?)>/g;
  while ((m = touchRe.exec(src))) {
    const attrs = m[1];
    const bodyEnd = src.indexOf('</TouchableOpacity>', m.index);
    const body = bodyEnd > 0 ? src.slice(m.index, bodyEnd) : '';
    if (!/MaterialCommunityIcons/.test(body) || !/<Text/.test(body)) continue;
    // A gradient child usually carries the row layout (the outer style is just a
    // shadow/radius wrapper).
    if (/Gradient\b/.test(attrs) || /LinearGradient/.test(body.split('<Text')[0])) continue;

    const names = [...attrs.matchAll(/styles\.([A-Za-z0-9_]+)/g)].map((x) => x[1]);
    // A vertical drop-zone/empty-state card is intentional.
    if (/UploadBox|DropZone|empty/i.test(names.join(' '))) continue;
    if (!names.length) continue;
    const rowOk = names.some((n) => /flexDirection:\s*['"]row['"]/.test(styles.get(n) ?? ''));
    if (rowOk) continue;
    const hasHeight = names.some((n) => /(?<![a-zA-Z])height:\s*[0-9.]+/.test(styles.get(n) ?? ''));
    if (!hasHeight) continue; // auto height grows around the stacked content

    console.log(`${file.split(path.sep).join('/')}:${lineOf(m.index)}  ${names.join(' + ')}`);
    flagged++;
  }
}
console.log(`\n${flagged} icon+label buttons without a row layout`);
