/**
 * The official NU Lipa Disposal Form's fixed vocabulary — the phone's copy of
 * the web's `App\Support\DisposalForms`, `DisposalCodes` and `DisposalReason`.
 *
 * Pure functions only: no database, no Expo. `lib/disposalForm.ts` uses these
 * to read and save the shared form rows, and `scripts/disposal-rules-check.mjs`
 * asserts they still say what the web says.
 */

export type DisposalFormStage = 'draft' | 'ready' | 'printed' | 'signed' | 'finalized';

export const DISPOSAL_FORM_STAGES: DisposalFormStage[] = ['draft', 'ready', 'printed', 'signed', 'finalized'];

const STAGE_COPY: Record<DisposalFormStage, { label: string; hint: string }> = {
  draft: {
    label: 'Awaiting preparation',
    hint: 'Missing details must be completed before the form can be printed.',
  },
  ready: {
    label: 'Ready to print',
    hint: 'Complete and validated — select it for printing.',
  },
  printed: {
    label: 'Printed — awaiting signed form',
    hint: 'Printing is recorded. The signature does not exist yet: file the signed copy when Accountancy returns it.',
  },
  signed: {
    label: 'Signed form received',
    hint: 'The signed form is on file. The disposal can now be finalized.',
  },
  finalized: {
    label: 'Disposal finalized',
    hint: 'The assets have been disposed of and recorded.',
  },
};

export const normalizeStage = (raw: unknown): DisposalFormStage => {
  const key = String(raw ?? '').trim().toLowerCase();
  return (DISPOSAL_FORM_STAGES as string[]).includes(key) ? (key as DisposalFormStage) : 'draft';
};

/** Is this a stage the database actually stores? */
export const isKnownStage = (raw: unknown): boolean =>
  (DISPOSAL_FORM_STAGES as string[]).includes(String(raw ?? '').trim().toLowerCase());

export const stageLabel = (stage: string | null | undefined): string =>
  isKnownStage(stage) ? STAGE_COPY[normalizeStage(stage)].label : 'Not prepared yet';

export const stageHint = (stage: string | null | undefined): string =>
  isKnownStage(stage)
    ? STAGE_COPY[normalizeStage(stage)].hint
    : 'The official form has not been generated for this request yet.';

/** The web's `DisposalCodes::METHOD_CODES`, in the form's order. */
export const DISPOSAL_FORM_METHODS = [
  { key: 'donated', code: 'D', label: 'Donated' },
  { key: 'tender-sold', code: 'T', label: 'Tender/sold' },
  { key: 'scrap', code: 'S', label: 'Scrap' },
  { key: 'trade-in', code: 'T', label: 'Trade-in' },
] as const;

/** The values `disposals.disposal_reason` accepts (web `DisposalReason::VALUES`). */
export const DISPOSAL_APPROVAL_REASONS = ['Beyond Repair', 'Obsolete', 'Replace', 'Lost', 'Damage'] as const;

export type DisposalApprovalReason = (typeof DISPOSAL_APPROVAL_REASONS)[number];

export const methodOf = (key: string | null | undefined) =>
  DISPOSAL_FORM_METHODS.find((method) => method.key === String(key ?? '').trim()) ?? null;

export const methodLabel = (key: string | null | undefined): string => {
  const method = methodOf(key);
  return method ? `${method.code} — ${method.label}` : '';
};

export const methodCode = (key: string | null | undefined): string | null => methodOf(key)?.code ?? null;

/**
 * Read the disposal reason out of the requester's note, exactly like
 * `DisposalReason::derive()` — most specific/serious first.
 */
export function deriveDisposalReason(note: string | null | undefined): DisposalApprovalReason {
  const haystack = String(note ?? '').trim().toLowerCase();
  if (!haystack) return 'Obsolete';

  const keywords: Record<DisposalApprovalReason, string[]> = {
    'Beyond Repair': [
      'beyond repair',
      'cannot be repaired',
      "can't be repaired",
      'not repairable',
      'irreparable',
      'unrepairable',
      'no longer repairable',
      'totally damaged',
    ],
    Lost: ['lost', 'missing', 'cannot be found', "can't be found", 'stolen', 'theft'],
    Replace: ['replace', 'replacement', 'upgrade', 'upgraded', 'newer model'],
    Damage: ['damage', 'damaged', 'broken', 'cracked', 'faulty', 'defective', 'not working'],
    Obsolete: [
      'obsolete',
      'outdated',
      'end of life',
      'end of lifespan',
      'end of its lifespan',
      'no longer needed',
      'no longer used',
      'unused',
      'surplus',
    ],
  };

  for (const reason of ['Beyond Repair', 'Lost', 'Replace', 'Damage', 'Obsolete'] as DisposalApprovalReason[]) {
    if (keywords[reason].some((keyword) => haystack.includes(keyword))) return reason;
  }
  return 'Obsolete';
}

/** An explicit, recognised reason — otherwise the one derived from the note. */
export function normalizeDisposalReason(raw: unknown, note?: string | null): DisposalApprovalReason {
  const value = String(raw ?? '').trim();
  const match = DISPOSAL_APPROVAL_REASONS.find((reason) => reason.toLowerCase() === value.toLowerCase());
  return match ?? deriveDisposalReason(note);
}

/** The code the form prints for a stored reason (web `DisposalCodes::reasonCodeFor`). */
export function reasonCodeFor(reason: string | null | undefined): string | null {
  switch (String(reason ?? '').trim()) {
    case 'Beyond Repair':
      return 'B';
    case 'Obsolete':
      return 'O';
    case 'Replace':
      return 'R';
    default:
      // Lost and Damage have no matching row on the official form; guessing
      // would record a decision nobody made.
      return null;
  }
}

/** An asset's recorded Condition as a form code, or null (web parity). */
export function conditionCodeFor(condition: string | null | undefined): string | null {
  switch (String(condition ?? '').trim().toLowerCase()) {
    case 'poor':
      return 'P';
    case 'fair':
      return 'F';
    case 'good':
      return 'G';
    default:
      return null;
  }
}
