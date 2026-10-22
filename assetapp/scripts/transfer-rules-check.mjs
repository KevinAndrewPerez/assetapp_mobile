// Transfer validation matrix, without a database:
// `node scripts/transfer-rules-check.mjs`.
import { transferAssetRefusal, transferTargetRefusal } from '../lib/transferRules.ts';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures += 1;
    console.log(`FAIL ${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  } else {
    console.log(`ok   ${label}`);
  }
};

const asset = (overrides = {}) => ({
  id: 7,
  Asset_code: 'AST-0007',
  Asset_name: 'Laptop',
  user_id: 12,
  Lifecycle_Status: 'Active',
  ...overrides,
});

/* ── receiver ─────────────────────────────────────────────────────────────── */

check('a different active employee is allowed', transferTargetRefusal({ fromUserId: 12, toUserId: 13, targetStatus: 'Active' }), null);
check('the same employee is refused', transferTargetRefusal({ fromUserId: 12, toUserId: '12', targetStatus: 'Active' }), 'Choose a different receiving employee.');
check('an inactive receiver is refused', transferTargetRefusal({ fromUserId: 12, toUserId: 13, targetStatus: 'Inactive' }), 'The receiving employee has a deactivated account, so assets cannot be assigned to them.');
check('status casing does not hide inactivity', transferTargetRefusal({ fromUserId: 12, toUserId: 13, targetStatus: ' inactive ' }), 'The receiving employee has a deactivated account, so assets cannot be assigned to them.');
check('a missing status is treated as active', transferTargetRefusal({ fromUserId: 12, toUserId: 13, targetStatus: null }), null);

/* ── assets ───────────────────────────────────────────────────────────────── */

check('an active asset in the sender\'s custody is allowed', transferAssetRefusal(asset(), 12, 'Juan'), null);
check('a string id matches a numeric owner', transferAssetRefusal(asset({ user_id: '12' }), 12, 'Juan'), null);
check('an asset held by somebody else is refused', transferAssetRefusal(asset({ user_id: 99 }), 12, 'Juan'), 'Laptop (AST-0007) is no longer assigned to Juan. Reload and try again.');
check('an unassigned asset is refused', transferAssetRefusal(asset({ user_id: null }), 12, 'Juan'), 'Laptop (AST-0007) is no longer assigned to Juan. Reload and try again.');
check('a disposed asset is refused', transferAssetRefusal(asset({ Lifecycle_Status: 'Disposal' }), 12, 'Juan'), "Laptop (AST-0007) has left the employee's custody and cannot be transferred.");
check('a disposed asset with messy casing is refused', transferAssetRefusal(asset({ Lifecycle_Status: ' DISPOSED ' }), 12, 'Juan'), "Laptop (AST-0007) has left the employee's custody and cannot be transferred.");
check('a pulled-out asset is refused', transferAssetRefusal(asset({ Lifecycle_Status: 'Pullout' }), 12, 'Juan'), "Laptop (AST-0007) has left the employee's custody and cannot be transferred.");
check('a pulled-out asset with the display label is refused', transferAssetRefusal(asset({ Lifecycle_Status: 'Pulled Out' }), 12, 'Juan'), "Laptop (AST-0007) has left the employee's custody and cannot be transferred.");
check('a For Repair asset can travel with the employee', transferAssetRefusal(asset({ Lifecycle_Status: 'For Repair' }), 12, 'Juan'), null);
check('a For Replacement asset can travel with the employee', transferAssetRefusal(asset({ Lifecycle_Status: 'For Replacement' }), 12, 'Juan'), null);
check('an asset with no name still gets a readable label', transferAssetRefusal(asset({ Asset_name: null, Asset_code: null, user_id: 99 }), 12, 'Juan'), 'Asset is no longer assigned to Juan. Reload and try again.');

console.log('');
if (failures > 0) {
  console.log(`${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log('All transfer rule assertions passed.');
