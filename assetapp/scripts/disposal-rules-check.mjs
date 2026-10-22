// The official NU Lipa Disposal Form's fixed vocabulary, checked against the
// web's `DisposalForms` / `DisposalCodes` / `DisposalReason` rules.
// Pure logic, no database: `node scripts/disposal-rules-check.mjs`.
import {
  conditionCodeFor,
  deriveDisposalReason,
  methodCode,
  methodLabel,
  methodOf,
  normalizeDisposalReason,
  normalizeStage,
  reasonCodeFor,
  stageHint,
  stageLabel,
} from '../lib/disposalRules.ts';

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

/* ── stages (web DisposalForms::label/hint) ──────────────────────────────── */
check('draft label', stageLabel('draft'), 'Awaiting preparation');
check('ready label', stageLabel('ready'), 'Ready to print');
check('printed label', stageLabel('printed'), 'Printed — awaiting signed form');
check('signed label', stageLabel('signed'), 'Signed form received');
check('finalized label', stageLabel('finalized'), 'Disposal finalized');
check('unknown stage label', stageLabel('whatever'), 'Not prepared yet');
check('stage normalisation is case-insensitive', normalizeStage('  FINALIZED '), 'finalized');
check('printed hint mentions the signature', stageHint('printed').includes('signature'), true);

/* ── methods (web DisposalCodes::METHOD_CODES) ───────────────────────────── */
check('method label donated', methodLabel('donated'), 'D — Donated');
check('method label tender-sold', methodLabel('tender-sold'), 'T — Tender/sold');
check('method label trade-in', methodLabel('trade-in'), 'T — Trade-in');
check('method code scrap', methodCode('scrap'), 'S');
check('unknown method is refused', methodOf('sold'), null);
check('unknown method label', methodLabel('sold'), '');

/* ── reason derivation (web DisposalReason::derive) ──────────────────────── */
check('empty note → Obsolete', deriveDisposalReason(''), 'Obsolete');
check('beyond repair beats damage', deriveDisposalReason('Screen damaged beyond repair'), 'Beyond Repair');
check('missing → Lost', deriveDisposalReason('The unit is missing from the lab'), 'Lost');
check('upgrade → Replace', deriveDisposalReason('Upgrade to a newer model'), 'Replace');
check('cracked → Damage', deriveDisposalReason('The casing is cracked'), 'Damage');
check('surplus → Obsolete', deriveDisposalReason('Surplus to requirement'), 'Obsolete');
check('unknown wording falls back to Obsolete', deriveDisposalReason('xylophone'), 'Obsolete');

/* ── explicit reason normalisation (web DisposalReason::normalize) ───────── */
check('explicit reason wins', normalizeDisposalReason('Lost', 'damaged beyond repair'), 'Lost');
check('explicit reason is case-insensitive', normalizeDisposalReason('beyond repair', ''), 'Beyond Repair');
check('unknown explicit reason falls back to the note', normalizeDisposalReason('scrapped', 'obsolete unit'), 'Obsolete');

/* ── codes (web DisposalCodes::reasonCodeFor / conditionCodeFor) ────────── */
check('Beyond Repair → B', reasonCodeFor('Beyond Repair'), 'B');
check('Obsolete → O', reasonCodeFor('Obsolete'), 'O');
check('Replace → R', reasonCodeFor('Replace'), 'R');
check('Lost has no form code', reasonCodeFor('Lost'), null);
check('Damage has no form code', reasonCodeFor('Damage'), null);
check('Condition Poor → P', conditionCodeFor('Poor'), 'P');
check('Condition Fair → F', conditionCodeFor('fair'), 'F');
check('Condition Good → G', conditionCodeFor(' Good '), 'G');
check('Condition New is not guessed', conditionCodeFor('New'), null);
check('Condition Excellent is not guessed', conditionCodeFor('Excellent'), null);

/* ── invariants the flow relies on ──────────────────────────────────────── */
for (const reason of ['Lost', 'Damage']) {
  if (reasonCodeFor(reason) !== null) {
    failures += 1;
    console.log(`FAIL ${reason} must not be mapped onto a form row nobody chose`);
  }
}
// Both T rows print the same letter — the key is what tells them apart.
if (methodCode('tender-sold') !== methodCode('trade-in') || methodCode('tender-sold') !== 'T') {
  failures += 1;
  console.log('FAIL the two T methods must share the letter T while keeping distinct keys');
}

console.log('');
if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('All disposal-rule checks passed.');
