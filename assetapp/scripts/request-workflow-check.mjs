// Approval rules shared by the Requests screen and the write path:
// `node scripts/request-workflow-check.mjs`.
import { decisionRefusal, allowedDecisions, isDecidable } from '../lib/requestWorkflow.ts';

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

const base = {
  requestStatus: 'Pending',
  requestSubmitterId: 20,
  actorId: 1,
  actorRole: 'Admin',
  actorActive: true,
  target: 'Approved',
};

check('a pending request can be approved or rejected', allowedDecisions('Pending'), ['Approved', 'Rejected']);
check('a pending request is decidable', isDecidable(' pending '), true);
check('an approved request is final', allowedDecisions('Approved'), []);
check('a rejected request is final', allowedDecisions('Rejected'), []);
check('an office account can decide another user\'s pending request', decisionRefusal(base), null);
check('a Department Head cannot decide', decisionRefusal({ ...base, actorRole: 'Department Head' }), 'Only the Asset Management Office can approve or reject a request.');
check('an Employee cannot decide', decisionRefusal({ ...base, actorRole: 'Employee' }), 'Only the Asset Management Office can approve or reject a request.');
check('a missing account cannot decide', decisionRefusal({ ...base, actorId: null }), 'Your account could not be verified. Please sign in again.');
check('an inactive account cannot decide', decisionRefusal({ ...base, actorActive: false }), 'This account is inactive and can no longer decide requests.');
check('nobody decides their own request', decisionRefusal({ ...base, requestSubmitterId: 1 }), 'You cannot approve or reject your own request. It has to be decided by the Asset Management Office.');
check('string/number ids still match for self-approval', decisionRefusal({ ...base, requestSubmitterId: '1' }), 'You cannot approve or reject your own request. It has to be decided by the Asset Management Office.');
check('an already approved request cannot be approved again', decisionRefusal({ ...base, requestStatus: 'Approved' }), 'Only pending requests can be approved. This request is already Approved.');
check('an already rejected request cannot be rejected again', decisionRefusal({ ...base, target: 'Rejected', requestStatus: 'Rejected' }), 'Only pending requests can be rejected. This request is already Rejected.');
check('status casing does not make a decided request decidable', decisionRefusal({ ...base, requestStatus: ' approved ' }), 'Only pending requests can be approved. This request is already  approved .');
check('a pending request with no submitter can be decided', decisionRefusal({ ...base, requestSubmitterId: null }), null);

console.log('');
if (failures > 0) {
  console.log(`${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log('All request workflow assertions passed.');
