/**
 * Which repair actions a record offers.
 *
 * The Repair Management card used to decide this inline, which made it easy for
 * a button to disagree with the status pill beside it: a Completed repair could
 * still offer "Update Details", and a Pending repair whose asset had already
 * gone to disposal still offered "Start Repair" even though starting it could
 * not move that asset anywhere.
 *
 * One pure rule set now answers every one of those questions, so the buttons,
 * the status message and any future caller (e.g. a dashboard shortcut) cannot
 * drift apart. `status` is the repair row's status; `lifecycleStatus` is the
 * asset's `Lifecycle_Status`.
 */

export type RepairActionStatus = 'Pending' | 'In Progress' | 'Completed' | 'Cancelled';

export type RepairActionState = {
  /** Pending only: nothing has been started yet. */
  canStart: boolean;
  /** Pending / In Progress: the evaluation can still be recorded. */
  canComplete: boolean;
  /** Pending / In Progress: the repair can still be cancelled. */
  canCancel: boolean;
  /** Servicing details may still be edited (same window as completing). */
  canFinalize: boolean;
  /** The asset may still be sent to Replacement / Disposal. */
  canSend: boolean;
  /** Nothing further can be done — the record is history. */
  isFinal: boolean;
  /** Why the record is final, for the card's status message. */
  reason: 'closed' | 'left-repair-process' | null;
  /** The asset's lifecycle status, trimmed and lower-cased once. */
  lifecycleKey: string;
};

const REPAIR_CLOSED: RepairActionStatus[] = ['Completed', 'Cancelled'];

/** Lifecycle values that mean the asset already left the repair process. */
const LEFT_REPAIR_PROCESS = ['disposal', 'disposed', 'for replacement', 'replacement'];

export function repairActionState(
  status: string | null | undefined,
  lifecycleStatus: string | null | undefined,
): RepairActionState {
  const repairStatus = String(status ?? '').trim() as RepairActionStatus;
  const lifecycleKey = String(lifecycleStatus ?? '').trim().toLowerCase();

  const closed = REPAIR_CLOSED.includes(repairStatus);
  const leftProcess = LEFT_REPAIR_PROCESS.includes(lifecycleKey);
  const open = (repairStatus === 'Pending' || repairStatus === 'In Progress') && !closed;

  const canAct = open && !leftProcess;

  return {
    canStart: canAct && repairStatus === 'Pending',
    canComplete: canAct,
    canCancel: canAct,
    canFinalize: canAct,
    canSend: canAct,
    isFinal: !canAct,
    reason: closed ? 'closed' : leftProcess ? 'left-repair-process' : null,
    lifecycleKey,
  };
}
