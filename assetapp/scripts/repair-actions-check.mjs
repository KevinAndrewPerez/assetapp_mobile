// Verifies the repair status → action matrix used by the Repair Management
// screen. Pure logic, no database: `node .repair-actions-check.mjs`.
import { repairActionState } from '../lib/repairActions.ts';

const cases = [
  // status, lifecycle, expected flags, label
  ['Pending', 'Active', { canStart: true, canComplete: true, canCancel: true, canFinalize: true, canSend: true, isFinal: false, reason: null }, 'pending repair, asset active'],
  ['In Progress', 'For Repair', { canStart: false, canComplete: true, canCancel: true, canFinalize: true, canSend: true, isFinal: false, reason: null }, 'started repair'],
  ['Completed', 'Active', { canStart: false, canComplete: false, canCancel: false, canFinalize: false, canSend: false, isFinal: true, reason: 'closed' }, 'completed repair'],
  ['Cancelled', 'Active', { canStart: false, canComplete: false, canCancel: false, canFinalize: false, canSend: false, isFinal: true, reason: 'closed' }, 'cancelled repair'],
  ['Pending', 'Disposal', { canStart: false, canComplete: false, canCancel: false, canFinalize: false, canSend: false, isFinal: true, reason: 'left-repair-process' }, 'pending repair, asset disposed'],
  ['In Progress', 'For Replacement', { canStart: false, canComplete: false, canCancel: false, canFinalize: false, canSend: false, isFinal: true, reason: 'left-repair-process' }, 'open repair, asset in replacement'],
  ['Pending', 'Pulled Out', { canStart: true, canComplete: true, canCancel: true, canFinalize: true, canSend: true, isFinal: false, reason: null }, 'pullout asset under repair'],
  [' In Progress ', ' DISPOSED ', { canStart: false, canComplete: false, canCancel: false, canFinalize: false, canSend: false, isFinal: true, reason: 'left-repair-process' }, 'messy casing/whitespace'],
  ['Cancelled', 'For Replacement', { canStart: false, canComplete: false, canCancel: false, canFinalize: false, canSend: false, isFinal: true, reason: 'closed' }, 'cancelled repair on replaced asset'],
  [null, null, { canStart: false, canComplete: false, canCancel: false, canFinalize: false, canSend: false, isFinal: true, reason: null }, 'record with no status'],
];

let failures = 0;
for (const [status, lifecycle, expected, label] of cases) {
  const actual = repairActionState(status, lifecycle);
  const mismatched = Object.entries(expected).filter(([key, value]) => actual[key] !== value);
  if (mismatched.length > 0) {
    failures += 1;
    console.log(`FAIL ${label} (${status} / ${lifecycle})`);
    for (const [key, value] of mismatched) {
      console.log(`   ${key}: expected ${value}, got ${actual[key]}`);
    }
  } else {
    console.log(`ok   ${label}`);
  }
}

// One invariant the screen relies on: no action can be offered on a record
// that reports itself final, and a final record must say why it closed.
for (const [status, lifecycle] of cases) {
  const state = repairActionState(status, lifecycle);
  if (state.isFinal && (state.canStart || state.canComplete || state.canCancel || state.canFinalize || state.canSend)) {
    failures += 1;
    console.log(`FAIL final record still offers an action (${status} / ${lifecycle})`);
  }
  if (state.isFinal && state.reason === null && status) {
    failures += 1;
    console.log(`FAIL final record does not explain itself (${status} / ${lifecycle})`);
  }
  if (!state.canSend && (state.canStart || state.canFinalize)) {
    failures += 1;
    console.log(`FAIL send gated differently from the other actions (${status} / ${lifecycle})`);
  }
}

console.log(failures === 0 ? '\nAll repair action rules hold.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
