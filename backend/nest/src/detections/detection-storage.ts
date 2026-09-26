import type { Detection } from './detection.entity';
import { storedEvidenceUrls } from './severity-storage';

/**
 * Every distinct served file a detection points at, uploads and evidence
 * renders alike. These are object-storage keys (`detections/<uuid>.jpg`), and
 * the same strings are the keys of their access grants.
 */
export function storedImageUrls(detection: Detection): string[] {
  const urls = new Set<string>();
  if (detection.image) urls.add(detection.image);
  detection.images?.forEach((image) => urls.add(image.url));
  detection.eyeResults?.forEach((analysis) =>
    analysis.images?.forEach((url) => urls.add(url)),
  );
  storedEvidenceUrls(detection.phase2Summary).forEach((url) => urls.add(url));
  return [...urls];
}

/** Everything in storage that goes when the detection does: the files above
 * plus its measurement packets, which are stored but never served as a file. */
export function storedObjectKeys(detection: Detection): string[] {
  const keys = storedImageUrls(detection);
  if (detection.phase2EvidenceKey) keys.push(detection.phase2EvidenceKey);
  return keys;
}
