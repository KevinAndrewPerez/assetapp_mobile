/**
 * Supporting documents attached to a disposal request — inspection reports,
 * appraisals, board approvals, photographs of the item.
 *
 * The mobile half of the web's `App\Support\DisposalDocuments`, with the same
 * gates, because they are policy rather than presentation:
 *
 *   - only a Disposal request can carry them (not a repair or a transfer);
 *   - only once that request is **Approved** — a pending request has no
 *     disposal to document yet, and a rejected one never will;
 *   - PDF, JPG, PNG or WEBP, at most 5 MB (the web's MIME list and cap);
 *   - refused once the disposal has been finalized (or a legacy record has
 *     been completed/archived): at that point the documentation is part of the
 *     historical record.
 *
 * One deliberate difference: the web keeps the file on its private local disk
 * and serves it through an authorized route; the phone has no such route, so
 * documents go into the project's Storage bucket the same way every other
 * mobile upload does. Object keys carry a random component, but the bucket is
 * public — so a supporting document is exactly as private as the request
 * attachments this app already stores there, and no more.
 */
import * as DocumentPicker from 'expo-document-picker';

import { storeMedia, type MediaAsset, type UploadedMedia } from './mediaUpload';
import { supabase } from './supabase';
import { writeAudit } from './auditService';
import { fetchActorProfile, officeRefusal } from './access';
import { normalizeDisposalStatus } from './disposalService';
import { readNote } from './noteUtils';

/** The web's list (`DisposalDocuments::MIMES`). */
export const DISPOSAL_DOCUMENT_EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png', 'webp'] as const;

/** The web's cap, in kilobytes (5 MB). */
export const DISPOSAL_DOCUMENT_MAX_KB = 5120;

export const DISPOSAL_DOCUMENT_TITLE_MAX = 150;

const FOLDER = 'disposal_documents';

export type DisposalDocument = {
  id: string;
  requestId: string;
  assetId: string | null;
  title: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  mime: string;
  uploadedBy: string | null;
  createdAt: string;
};

export type DisposalDocumentResult = { ok: boolean; message: string; id?: string };

const normalizedRequestType = (value: unknown): string => String(value ?? '').trim().toLowerCase();

export const formatDocumentSize = (bytes: number | null | undefined): string => {
  const value = Number(bytes ?? 0);
  if (!Number.isFinite(value) || value <= 0) return '—';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
};

const mapDocument = (row: any): DisposalDocument => ({
  id: String(row?.id ?? ''),
  requestId: String(row?.request_id ?? ''),
  assetId: row?.asset_id == null ? null : String(row.asset_id),
  title: String(row?.title ?? ''),
  fileName: String(row?.file_name ?? ''),
  filePath: String(row?.file_path ?? ''),
  fileSize: Number(row?.file_size ?? 0),
  mime: String(row?.mime ?? ''),
  uploadedBy: row?.uploaded_by == null ? null : String(row.uploaded_by),
  createdAt: String(row?.created_at ?? ''),
});

/** Has `2026_10_20_000000_create_disposal_documents_table` run? */
export async function disposalDocumentsReady(): Promise<boolean> {
  try {
    const { error } = await supabase.from('disposal_documents').select('id').limit(1);
    return !error;
  } catch {
    return false;
  }
}

/** Every supporting document attached to one request, newest first. */
export async function fetchDisposalDocuments(requestId: string | number): Promise<DisposalDocument[]> {
  const { data, error } = await supabase
    .from('disposal_documents')
    .select('id, request_id, asset_id, title, file_name, file_path, file_size, mime, uploaded_by, created_at')
    .eq('request_id', requestId)
    .order('created_at', { ascending: false });

  if (error) {
    if (/relation .* does not exist|schema cache/i.test(error.message)) return [];
    throw error;
  }

  return (data ?? []).map(mapDocument);
}

/**
 * Why documents can no longer be removed, or null when they still can.
 *
 * Same two locks as the web: a finalized form, or a disposal record already
 * written for this request.
 */
export async function documentLockReason(requestId: string | number): Promise<string | null> {
  try {
    const { data: form, error } = await supabase
      .from('disposal_forms')
      .select('status')
      .eq('request_id', requestId)
      .maybeSingle();

    if (!error && form && ['finalized', 'completed', 'disposed'].includes(String(form.status ?? '').toLowerCase())) {
      return 'This disposal has been finalized. Its documents are part of the historical record and can no longer be removed.';
    }
  } catch {
    // No forms table on this database: the disposals check below still applies.
  }

  // Approving a disposal request no longer writes a record — the official-form
  // workflow writes one only at finalization — so "a row exists" cannot mean
  // "the disposal is history". A row that is Completed/Cancelled or archived is
  // closed history; a Pending/Approved row is a legacy record from the old
  // direct-disposal path, and the office is still collecting documentation.
  let disposalRows: any[] = [];
  const withArchive = await supabase
    .from('disposals')
    .select('Disposal_ID, notes, is_archived')
    .eq('Request_id', requestId as any);

  if (withArchive.error) {
    const plain = await supabase
      .from('disposals')
      .select('Disposal_ID, notes')
      .eq('Request_id', requestId as any);
    disposalRows = (plain.data ?? []) as any[];
  } else {
    disposalRows = (withArchive.data ?? []) as any[];
  }

  if (disposalRows.some((row) => Boolean(row?.is_archived))) {
    return 'This disposal record is archived. Its documents are part of the historical record and can no longer be removed.';
  }

  const closed = disposalRows.some((row) => {
    const status = normalizeDisposalStatus(readNote(row?.notes, 'Status'));
    return status === 'Completed' || status === 'Cancelled';
  });
  if (closed) {
    return 'This disposal has already been completed. Its documents are part of the historical record and can no longer be removed.';
  }

  return null;
}

/** Whether this request can take documents at all, and why not when it cannot. */
export async function documentAttachReason(requestId: string | number): Promise<string | null> {
  const { data: request, error } = await supabase
    .from('requests')
    .select('id, request_type, status')
    .eq('id', requestId)
    .maybeSingle();

  if (error) throw error;
  if (!request) return 'That disposal request no longer exists.';
  if (normalizedRequestType((request as any).request_type) !== 'disposal') {
    return 'Supporting documents can only be attached to a disposal request.';
  }
  if (normalizedRequestType((request as any).status) !== 'approved') {
    return `Documents can be attached once the disposal request has been approved. This request is ${(request as any).status}.`;
  }
  if (!(await disposalDocumentsReady())) {
    return 'The disposal documents table has not been created yet — run the database migration first.';
  }

  return null;
}

/** The `form_id` link, when the generated official form exists. */
async function formIdFor(requestId: string | number): Promise<string | number | null> {
  try {
    const { data, error } = await supabase.from('disposal_forms').select('id').eq('request_id', requestId).maybeSingle();
    if (error) return null;
    return data?.id ?? null;
  } catch {
    return null;
  }
}

/** The extension a picked document should be stored under. */
const extensionOf = (media: MediaAsset): string => {
  const name = String(media.fileName ?? media.uri ?? '').split('?')[0];
  const extension = name.includes('.') ? name.split('.').pop() ?? '' : '';
  if (extension) return extension.toLowerCase().replace(/[^a-z0-9]/g, '');

  const mime = String(media.mimeType ?? '').toLowerCase();
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'jpg';
};

/**
 * Attach one supporting document to an approved disposal request.
 *
 * Every refusal is a message the caller can show verbatim; nothing is uploaded
 * before the request (and its 5 MB cap) has been checked.
 */
export async function attachDisposalDocument(options: {
  requestId: string | number;
  actor: { id: string | number | null; label: string };
  media: string | MediaAsset;
  title?: string;
  assetId?: string | number | null;
}): Promise<DisposalDocumentResult> {
  const requestId = options.requestId;

  // The role is read from the database, not from the cached sign-in object.
  const profile = await fetchActorProfile(options.actor.id);
  const refusal = officeRefusal(
    profile,
    'Only the Asset Management Office can attach a supporting disposal document.',
  );
  if (refusal) return { ok: false, message: refusal };

  const attachReason = await documentAttachReason(requestId);
  if (attachReason) return { ok: false, message: attachReason };

  const lock = await documentLockReason(requestId);
  if (lock) return { ok: false, message: lock };

  const media: MediaAsset = typeof options.media === 'string' ? { uri: options.media } : options.media;
  const extension = extensionOf(media);

  if (!(DISPOSAL_DOCUMENT_EXTENSIONS as readonly string[]).includes(extension)) {
    return { ok: false, message: 'The document must be a PDF, JPG, PNG or WEBP file.' };
  }

  if (media.fileSize && media.fileSize > DISPOSAL_DOCUMENT_MAX_KB * 1024) {
    return { ok: false, message: `The document may not be larger than ${DISPOSAL_DOCUMENT_MAX_KB / 1024} MB.` };
  }

  const title = String(options.title ?? '').trim().slice(0, DISPOSAL_DOCUMENT_TITLE_MAX) || null;

  let stored: UploadedMedia;
  try {
    stored = await storeMedia({ folder: FOLDER, prefix: `disposal-${requestId}`, media });
  } catch (error) {
    return {
      ok: false,
      message: (error as any)?.message || 'The document could not be stored. Nothing was attached — please try again.',
    };
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('disposal_documents')
    .insert([
      {
        request_id: requestId,
        form_id: await formIdFor(requestId),
        asset_id: options.assetId ?? null,
        title,
        file_name: media.fileName || stored.fileName,
        file_path: stored.objectKey,
        file_size: stored.size,
        mime: stored.contentType,
        uploaded_by: options.actor.id ?? null,
        created_at: now,
        updated_at: now,
      },
    ])
    .select('id')
    .single();

  if (error) {
    console.error('Recording a disposal document failed:', error.message);
    return { ok: false, message: 'The document could not be attached. Nothing was changed — please try again.' };
  }

  const label = title || media.fileName || stored.fileName;

  // The document is already attached; a failed audit entry must not make the
  // screen report that it was not.
  try {
    await writeAudit({
      actorId: options.actor.id,
      requestId,
      actionType: 'UPDATE',
      description: `Attached supporting document "${label}" to disposal request #${requestId}`,
      notes: `Supporting document attached to disposal request #${requestId} by ${options.actor.label}.`,
    });
  } catch (auditError) {
    console.warn('Disposal document attached, but the audit entry failed:', auditError);
  }

  return { ok: true, id: String((data as any)?.id ?? ''), message: `“${label}” was attached to the disposal request.` };
}

/** Remove a supporting document from a request that is still being processed. */
export async function removeDisposalDocument(
  documentId: string | number,
  actor: { id: string | number | null; label: string },
): Promise<DisposalDocumentResult> {
  const profile = await fetchActorProfile(actor.id);
  const refusal = officeRefusal(
    profile,
    'Only the Asset Management Office can remove a supporting disposal document.',
  );
  if (refusal) return { ok: false, message: refusal };

  const { data: document, error } = await supabase
    .from('disposal_documents')
    .select('id, request_id, title, file_name, file_path')
    .eq('id', documentId)
    .maybeSingle();

  if (error) throw error;
  if (!document) return { ok: false, message: 'That document no longer exists.' };

  const lock = await documentLockReason((document as any).request_id);
  if (lock) return { ok: false, message: lock };

  const { error: deleteError } = await supabase.from('disposal_documents').delete().eq('id', documentId);
  if (deleteError) throw deleteError;

  const label = String((document as any).title || (document as any).file_name || `Document #${documentId}`);

  // The row is gone; the audit attempt must not turn that into a failure.
  try {
    await writeAudit({
      actorId: actor.id,
      requestId: (document as any).request_id,
      actionType: 'UPDATE',
      description: `Removed supporting document "${label}" from disposal request #${(document as any).request_id}`,
      notes: `Supporting document removed from disposal request #${(document as any).request_id} by ${actor.label}. The audit entry stays; the stored object is no longer linked to the request.`,
    });
  } catch (auditError) {
    console.warn('Disposal document removed, but the audit entry failed:', auditError);
  }

  return { ok: true, message: `“${label}” was removed from the disposal request.` };
}

/**
 * The picker the attach button opens: PDFs and the four image types the web
 * accepts, nothing else.
 */
export async function pickDisposalDocument(): Promise<MediaAsset | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
    ],
    multiple: false,
    copyToCacheDirectory: true,
  });

  if (result.canceled || !result.assets?.length) return null;

  const asset = result.assets[0];
  return {
    uri: asset.uri,
    mimeType: asset.mimeType ?? null,
    fileName: asset.name ?? null,
    fileSize: typeof asset.size === 'number' ? asset.size : null,
  };
}
