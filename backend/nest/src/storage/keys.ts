import { randomUUID } from 'crypto';
import { extname } from 'path';

/**
 * How stored files are named.
 *
 * The database holds a key, never a path: `detections/<uuid>.jpg`. A key means
 * the same thing on a laptop, on a server, and in Amazon S3, which is what lets
 * the storage move without touching a single row.
 *
 *   detections/   the photographs a doctor uploaded
 *   severity/     the evidence images the severity analysis rendered
 *   evidence/     the per-photograph measurement packets, one JSON per screening
 */
export const PHOTO_PREFIX = 'detections/';
export const RENDER_PREFIX = 'severity/';
export const EVIDENCE_PREFIX = 'evidence/';

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

/** One safe file name: letters, digits, dot, dash, underscore, not starting
 * with a dot. Anything else — a slash, `..`, a space — is refused. */
const SAFE_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

export function isSafeName(name: string): boolean {
  return SAFE_NAME.test(name);
}

/** True for a key this app wrote: a known folder and one safe name. */
export function isOwnedKey(key: string): boolean {
  const slash = key.indexOf('/');
  if (slash < 0) return false;
  const folder = key.slice(0, slash + 1);
  const name = key.slice(slash + 1);
  return (
    [PHOTO_PREFIX, RENDER_PREFIX, EVIDENCE_PREFIX].includes(folder) &&
    isSafeName(name)
  );
}
