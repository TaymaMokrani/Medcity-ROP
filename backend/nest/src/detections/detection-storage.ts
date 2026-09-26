import { basename, join } from 'path';
import { unlink } from 'fs/promises';
import type { Detection } from './detection.entity';
import { UPLOAD_DIR, URL_PREFIX } from './upload.config';
import {
  SEVERITY_UPLOAD_DIR,
  SEVERITY_URL_PREFIX,
  storedEvidenceUrls,
} from './severity-storage';

/** Which folder a URL belongs to. Anything not listed here is not ours to delete. */
const OWNED: [prefix: string, dir: string][] = [
  [URL_PREFIX, UPLOAD_DIR],
  [SEVERITY_URL_PREFIX, SEVERITY_UPLOAD_DIR],
];

/** Every distinct file a detection points at, uploads and evidence alike. */
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

export async function removeStoredImages(urls: string[]): Promise<void> {
  await Promise.all(
    urls.map(async (url) => {
      const owner = OWNED.find(([prefix]) => url.startsWith(prefix));
      if (!owner) return;
      // basename pins the target inside the folder whatever the URL contains
      try {
        await unlink(join(owner[1], basename(url)));
      } catch {
        // already gone, or not ours to delete
      }
    }),
  );
}
