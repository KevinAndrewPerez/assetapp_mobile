import { supabase } from './supabase';

export type AuditEntry = {
  actorId?: string | number | null;
  assetId?: string | number | null;
  requestId?: string | number | null;
  actionType: string;
  description: string;
  notes?: string;
};

/**
 * Append an entry to the shared `audit_logs` trail. Best-effort: a logging
 * failure must never roll back or block the action the user actually performed.
 */
export async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    const now = new Date().toISOString();
    await supabase.from('audit_logs').insert([
      {
        user_id: entry.actorId ?? null,
        asset_id: entry.assetId ?? null,
        request_id: entry.requestId ?? null,
        notes: entry.notes ?? entry.description,
        action_type: entry.actionType,
        action_description: entry.description,
        created_at: now,
        updated_at: now,
      },
    ]);
  } catch (err) {
    console.warn('Audit log write failed:', err);
  }
}
