/**
 * Asset code rules for the Asset Registry.
 *
 * The registry lets the admin either **auto-generate** a code (the original
 * behaviour: AST-<category initials>-<name initials>-<random>) or **enter the
 * client's own code** — many NU Lipa units already have codes printed on their
 * stickers, and re-labelling every unit would be wrong.
 *
 * Whatever path is used, the code is what the QR sticker encodes, so it must be:
 *   • non-empty and reasonably short
 *   • upper-cased and free of separators that would break the QR payload
 *   • unique — the caller checks it against `assets.Asset_code` before saving
 */

/** Longest code we accept — comfortably inside what a QR sticker can print. */
export const MAX_ASSET_CODE_LENGTH = 40;

/** Fields behind the auto-generated code. */
export type AutoCodeInput = {
  category?: string;
  name?: string;
};

const initials = (value: string | undefined, fallback: string, max: number): string => {
  const cleaned = String(value ?? '')
    .split(/\s+/)
    .map((word) => word.charAt(0))
    .join('')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return cleaned.slice(0, max) || fallback;
};

/** `AST-IE-DL-X7Q2` — built from the category and the asset name. */
export const buildAssetCode = ({ category, name }: AutoCodeInput = {}): string => {
  const categoryAbbr = initials(category || 'AST', 'AST', 4);
  const nameInitials = initials(name || 'AST', 'AST', 4);
  const randomPart = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `AST-${categoryAbbr}-${nameInitials}-${randomPart}`;
};

/**
 * Tidy a hand-typed code: trim, collapse inner whitespace and upper-case it.
 * Spaces become dashes so the value stays a single QR-friendly token.
 */
export const normalizeAssetCode = (raw: unknown): string =>
  String(raw ?? '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9._-]/g, '')
    .toUpperCase();

/** Why a hand-typed code cannot be used, or `null` when it is fine. */
export const assetCodeProblem = (raw: unknown): string | null => {
  const value = normalizeAssetCode(raw);
  if (!value) return 'Enter the asset code printed on the existing sticker.';
  if (value.length < 3) return 'An asset code needs at least 3 characters.';
  if (value.length > MAX_ASSET_CODE_LENGTH) {
    return `Asset codes can be at most ${MAX_ASSET_CODE_LENGTH} characters.`;
  }
  return null;
};

/**
 * Split the bulk textarea into codes: one per line, but commas and semicolons
 * are accepted too because people paste lists from spreadsheets that way.
 */
export const parseAssetCodeList = (raw: unknown): string[] =>
  String(raw ?? '')
    .split(/[\r\n,;]+/)
    .map((line) => normalizeAssetCode(line))
    .filter(Boolean);

/**
 * Sequential custom codes, e.g. `NUL-ASSET-` + 1 + 3 copies →
 * `NUL-ASSET-001`, `NUL-ASSET-002`, `NUL-ASSET-003`.
 *
 * This is the "sequential custom-code format" clients use when their records are
 * numbered; every code still becomes its own asset record with its own QR.
 */
export const buildSequentialCodes = (
  prefix: string,
  start: number,
  count: number,
  pad = 3,
): string[] => {
  const safeCount = Math.max(0, Math.min(500, Math.floor(count) || 0));
  const first = Math.max(0, Math.floor(start) || 0);
  const cleanedPrefix = String(prefix ?? '').replace(/\s+/g, '');
  return Array.from({ length: safeCount }, (_, index) =>
    normalizeAssetCode(`${cleanedPrefix}${String(first + index).padStart(pad, '0')}`),
  );
};

/** Case-insensitive duplicate check that also catches repeats inside a batch. */
export const findDuplicateCodes = (codes: string[], existing: Iterable<string>): string[] => {
  const taken = new Set(Array.from(existing, (code) => String(code).toUpperCase()));
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const raw of codes) {
    const code = String(raw ?? '').toUpperCase();
    if (!code) continue;
    if (taken.has(code) || seen.has(code)) {
      if (!duplicates.includes(code)) duplicates.push(code);
    }
    seen.add(code);
  }
  return duplicates;
};
