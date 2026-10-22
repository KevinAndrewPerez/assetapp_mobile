/**
 * Request approval rules, copied from the web's `/admin/requests/{id}/approve`
 * and `/reject` routes so the phone and the website cannot drift:
 *
 *   - only a **Pending** request can be decided;
 *   - deciding is the Asset Management Office's job (`Access::canDecideRequests`);
 *   - nobody decides their own request;
 *   - `requests.status` only stores Pending / Approved / Rejected. Progress after
 *     approval belongs to the per-asset workflow (repairs, disposal forms,
 *     replacements) and is never written to the request as "In Progress" or
 *     "Completed".
 *
 * Keeping the rule here means the card that draws the buttons and the function
 * that writes the row ask the same question.
 */

export type RequestDecision = 'Approved' | 'Rejected';

/** What can be decided from a given stored status — nothing, once decided. */
export function allowedDecisions(status: unknown): RequestDecision[] {
  const key = String(status ?? '').trim().toLowerCase();
  return key === 'pending' ? ['Approved', 'Rejected'] : [];
}

/** Can this status still be decided? */
export const isDecidable = (status: unknown): boolean => allowedDecisions(status).length > 0;

/** Human wording for the stored status, including what happens next. */
export function requestStatusHint(status: unknown): string {
  switch (String(status ?? '').trim().toLowerCase()) {
    case 'pending':
      return 'Waiting for the Asset Management Office. Only a pending request can be approved or rejected.';
    case 'approved':
      return 'Approved. This request can no longer be reconsidered here — continue the work on the asset’s own screen (repair, disposal, replacement).';
    case 'rejected':
      return 'Rejected. The requester was told; a rejected request is final.';
    default:
      return 'Only a pending request can be approved or rejected.';
  }
}

/**
 * Why a decision must be refused, or null when it is allowed.
 *
 * The inputs are read from the database by the caller (the request row and the
 * actor's live account row), not from AsyncStorage.
 */
export function decisionRefusal(options: {
  requestStatus: unknown;
  requestSubmitterId: string | number | null | undefined;
  actorId: string | number | null | undefined;
  actorRole: string | null | undefined;
  actorActive?: boolean;
  target: string;
}): string | null {
  const { requestStatus, requestSubmitterId, actorId, actorRole, actorActive = true, target } = options;

  if (!actorId) return 'Your account could not be verified. Please sign in again.';
  if (!actorActive) return 'This account is inactive and can no longer decide requests.';
  if (String(actorRole ?? '').trim() !== 'Admin') {
    return 'Only the Asset Management Office can approve or reject a request.';
  }
  if (
    requestSubmitterId !== null &&
    requestSubmitterId !== undefined &&
    String(requestSubmitterId) === String(actorId)
  ) {
    return 'You cannot approve or reject your own request. It has to be decided by the Asset Management Office.';
  }
  if (String(requestStatus ?? '').trim().toLowerCase() !== 'pending') {
    return `Only pending requests can be ${target === 'Approved' ? 'approved' : 'rejected'}. This request is already ${requestStatus}.`;
  }

  return null;
}
