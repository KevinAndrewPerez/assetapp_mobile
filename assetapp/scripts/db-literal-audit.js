/**
 * READ-ONLY static check: pull every literal the app assigns to / filters by
 * for the DB's enum-like columns, and flag values the migration enums reject.
 */
const fs = require('fs');
const path = require('path');

const ALLOWED = {
  Category: ['Furnitures and Fixtures', 'General and Office Equipment', 'Info and Equipment', 'laboratory Apparatus and equipment', 'library books', 'Motor vehicles', 'P.E Equipment', 'Low value Asset'],
  Condition: ['New', 'Excellent', 'Good', 'Fair', 'Existing'],
  Lifecycle_Status: ['Acquired', 'Active', 'For Repair', 'For Checking', 'For Replacement', 'Pullout', 'Disposal'],
  request_type: ['Repair', 'Disposal', 'Transfer', 'Replacement', 'Pullout', 'Other'],
  requestStatus: ['Pending', 'Approved', 'Rejected'], // requests.status
  Repair_result: ['Repairable', 'Beyond Repair', 'For Replacement'],
  disposal_reason: ['Beyond Repair', 'Replace', 'Obsolete', 'Lost', 'Damage'],
  replacement_reason: ['Beyond Repair', 'Obsolete', 'End of Lifespan', 'Lost', 'Damage'],
  action_type: ['CREATE', 'UPDATE', 'REPAIR', 'REPLACEMENT', 'DISPOSAL', 'TRANSFER', 'LOGIN', 'APPROVAL'],
  role: ['Admin', 'Employee', 'Department Head', 'Facilities'],
};

const ROOTS = ['lib', 'app', 'components'];
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.tsx?$/.test(e.name)) files.push(p);
  }
})(path.join(__dirname, '..', ...ROOTS.slice(0, 0)) || __dirname);

const all = [];
for (const root of ROOTS) {
  const dir = path.join(__dirname, '..', root);
  if (!fs.existsSync(dir)) continue;
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name)) all.push(p);
    }
  })(dir);
}

/** column pattern -> allowed set key */
const COLUMN_MAP = {
  Category: 'Category',
  Condition: 'Condition',
  Lifecycle_Status: 'Lifecycle_Status',
  request_type: 'request_type',
  Repair_result: 'Repair_result',
  disposal_reason: 'disposal_reason',
  replacement_reason: 'replacement_reason',
  action_type: 'action_type',
  actionType: 'action_type',
  role: 'role',
};

// values writeAudit maps onto the storable enum before inserting (see lib/auditService.ts)
const AUDIT_ALIASES = new Set(['PULLOUT', 'MAINTENANCE', 'ASSIGN', 'RECEIVE', 'ACCOUNTABILITY', 'EVALUATION']);

let violations = 0;
let aliased = 0;
for (const file of all) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const [col, key] of Object.entries(COLUMN_MAP)) {
      const allowed = ALLOWED[key];
      const re = new RegExp(`\\b${col}\\s*[:=]\\s*'([^']+)'`, 'g');
      let m;
      while ((m = re.exec(line))) {
        const v = m[1];
        if (!allowed.includes(v)) {
          if (key === 'action_type' && AUDIT_ALIASES.has(v)) {
            aliased++;
          } else {
            violations++;
            console.log(`\u2717 ${file.replace(/^.*assetapp[\\/]/, '')}:${i + 1}  ${col} = '${v}'  (allowed: ${allowed.join(', ')})`);
          }
        }
      }
      // filters: .eq('col', 'v') / .in('col', ['v', ...])
      const f = new RegExp(`\\.(eq|in)\\(\\s*['"\`]${col}['"\`]\\s*,\\s*(\\[[^\\]]*\\]|'[^']*')`, 'g');
      let fm;
      while ((fm = f.exec(line))) {
        const vals = fm[2].match(/'([^']*)'/g) || [];
        for (const raw of vals) {
          const v = raw.slice(1, -1);
          if (!allowed.includes(v)) {
            violations++;
            console.log(`\u2717 ${file.replace(/^.*assetapp[\\/]/, '')}:${i + 1}  filter ${col} = '${v}'  (allowed: ${allowed.join(', ')})`);
          }
        }
      }
    }
  });
}
if (aliased) {
  console.log(`\n\u2139 ${aliased} audit action type(s) are aliased by writeAudit before insert (PULLOUT→TRANSFER, MAINTENANCE→UPDATE)`);
}
console.log(violations ? `\n${violations} literal(s) the DB enum would reject` : '\n\u2713 every literal matches the DB enums');
