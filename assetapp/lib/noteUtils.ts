/**
 * Several legacy tables (`repairs`, `disposals`) have no columns for workflow
 * status or extra detail, but the Laravel web app renders their `notes` column
 * verbatim. These helpers keep that column machine-readable *and* human-readable
 * by appending `Key: value` segments separated by ` | `.
 */

export const NOTE_SEP = ' | ';

/** Split a notes string into its non-empty segments. */
export const splitNotes = (notes: string | null | undefined): string[] =>
  String(notes ?? '')
    .split(NOTE_SEP)
    .map((segment) => segment.trim())
    .filter(Boolean);

/**
 * Replace/add the given keys, preserving every other segment (including legacy
 * free text the user typed). Empty values remove the key.
 */
export const upsertNotes = (
  existing: string | null | undefined,
  patch: Record<string, string | number | null | undefined>,
): string => {
  const parts = splitNotes(existing);

  const keys = Object.keys(patch).filter(
    (key) => patch[key] !== undefined && patch[key] !== null && String(patch[key]).trim() !== '',
  );
  if (keys.length === 0) return parts.join(NOTE_SEP);

  const kept = parts.filter(
    (part) => !keys.some((key) => part.toLowerCase().startsWith(`${key.toLowerCase()}:`)),
  );
  const added = keys.map((key) => `${key}: ${String(patch[key]).trim()}`);
  return [...kept, ...added].join(NOTE_SEP);
};

/** Read the last occurrence of `key`, or '' when it isn't present. */
export const readNote = (notes: string | null | undefined, key: string): string => {
  const target = `${key.toLowerCase()}:`;
  const match = splitNotes(notes)
    .reverse()
    .find((part) => part.toLowerCase().startsWith(target));
  return match ? match.slice(target.length).trim() : '';
};
