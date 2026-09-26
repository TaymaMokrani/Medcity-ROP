import { randomUUID } from 'crypto';
import { extname } from 'path';

/**
 * How stored files are named.
 *
 * The database holds a key, never a path: `detections/<uuid>.jpg`. A key means
 * the same thing on a laptop, on a server, and in Amazon S3, which is what lets
 * the storage move without touching a single row.
 *
 *   detections/        the photographs a doctor uploaded
 *   severity/          the evidence images the severity analysis rendered
 *   evidence/          the per-photograph measurement packets, one JSON per screening
 *   staging/<job>/     a preview's photographs, held while its job waits in the queue
 *   jobs/<job>/        a preview's finished assessment and packets, until it is saved
 *
 * The last two are temporary: the nightly cleanup removes them.
 */
export const PHOTO_PREFIX = 'detections/';
export const RENDER_PREFIX = 'severity/';
export const EVIDENCE_PREFIX = 'evidence/';
export const STAGING_PREFIX = 'staging/';
export const JOB_PREFIX = 'jobs/';

/** The two folders the file route may serve. Evidence JSON is not one of them. */
export const SERVED_FOLDERS = ['detections', 'severity'] as const;
export type ServedFolder = (typeof SERVED_FOLDERS)[number];

export const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.json': 'application/json',
};

export function contentTypeOf(name: string): string {
  return (
    CONTENT_TYPES[extname(name).toLowerCase()] ?? 'application/octet-stream'
  );
}

/** A fresh key for an uploaded photograph. Only the extension is kept from the
 * doctor's file name, and only when it is one we know. */
export function newPhotoKey(originalName: string): string {
  const ext = extname(originalName).toLowerCase();
  return `${PHOTO_PREFIX}${randomUUID()}${ext in CONTENT_TYPES ? ext : ''}`;
}

export function evidenceKey(detectionId: string): string {
  return `${EVIDENCE_PREFIX}${detectionId}.json`;
}

/** Where a queued preview's photograph waits: `staging/<job>/L-0.jpg`. */
export function stagingKey(
  jobId: string,
  eye: 'Left' | 'Right',
  index: number,
  originalName: string,
): string {
  const ext = extname(originalName).toLowerCase();
  const kept = ext in CONTENT_TYPES ? ext : '';
  return `${STAGING_PREFIX}${jobId}/${eye[0]}-${index}${kept}`;
}

/** A preview job's finished assessment and its packets. */
export function jobSummaryKey(jobId: string): string {
  return `${JOB_PREFIX}${jobId}/summary.json`;
}

export function jobEvidenceKey(jobId: string): string {
  return `${JOB_PREFIX}${jobId}/evidence.json`;
}

/** One safe file name: letters, digits, dot, dash, underscore, not starting
 * with a dot. Anything else — a slash, `..`, a space — is refused. */
const SAFE_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

export function isSafeName(name: string): boolean {
  return SAFE_NAME.test(name);
}

/** True for a key this app wrote: a known folder, then safe names only —
 * one for a file folder, a job id and a name for the two job folders. */
export function isOwnedKey(key: string): boolean {
  const parts = key.split('/');
  const folder = `${parts[0]}/`;
  const names = parts.slice(1);
  const depth = [STAGING_PREFIX, JOB_PREFIX].includes(folder)
    ? 2
    : [PHOTO_PREFIX, RENDER_PREFIX, EVIDENCE_PREFIX].includes(folder)
      ? 1
      : 0;
  return depth > 0 && names.length === depth && names.every(isSafeName);
}
