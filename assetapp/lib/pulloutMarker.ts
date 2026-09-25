/**
 * The marker written into `repairs.notes` when a repair is started straight from
 * a pullout. An asset that came in that way returns to `Pullout` (never
 * `Active`) when its repair closes, because it was never released from storage.
 *
 * This lives in its own module rather than in the pullout service so the repair
 * service can read the marker without importing it:
 *
 *   repairService → pulloutService → userService → repairService
 *
 * was a require cycle Metro warned about on every bundle.
 */

export const CAME_FROM_PULLOUT_NOTE = 'From pullout #';

/** The `notes` value a pullout-started repair row is created with. */
export const pulloutMarkerNote = (pulloutId: string | number): string =>
  `${CAME_FROM_PULLOUT_NOTE}${pulloutId}`;

/** Whether a repair row entered repair from a pullout. */
export const repairCameFromPullout = (repairNotes: string | null | undefined): boolean =>
  String(repairNotes ?? '').includes(CAME_FROM_PULLOUT_NOTE);
