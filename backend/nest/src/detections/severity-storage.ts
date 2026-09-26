import type { SeverityService } from '../severity/severity.service';
import type { StorageService } from '../storage/storage.service';
import { RENDER_PREFIX } from '../storage/keys';

interface EvidenceBlock {
  map?: string;
  front?: string;
  photos?: { image?: string }[];
}

/** A name the severity service produced, pinned to one safe object name. */
function localName(detectionId: string, name: string): string {
  return `${detectionId}-${name.replace(/[^A-Za-z0-9._-]/g, '_')}`;
}

/**
 * Copies the rendered evidence into object storage and rewrites the assessment
 * to point at it.
 *
 * The frontend talks only to the gateway, and severity jobs are held in the
 * Python service's memory and expire. Keeping our own copy means the evidence
 * outlives the job, and survives the analyser being restarted.
 *
 * Best effort per image: one that cannot be fetched is dropped from the
 * assessment rather than left as a key that will 404 in the viewer.
 */
export async function storeEvidenceImages(
  storage: StorageService,
  severity: SeverityService,
  jobId: string,
  detectionId: string,
  summary: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const eyes = Array.isArray(summary.eyes) ? summary.eyes : [];
  const missing: string[] = [];

  const fetchOne = async (name: string): Promise<string | undefined> => {
    // Already ours: a preview that was stored once and is now being saved.
    if (name.startsWith(RENDER_PREFIX)) return name;
    try {
      const bytes = await severity.image(jobId, name);
      const key = `${RENDER_PREFIX}${localName(detectionId, name)}`;
      await storage.put(key, bytes);
      return key;
    } catch {
      missing.push(name);
      return undefined;
    }
  };

  for (const eye of eyes as { evidence?: EvidenceBlock }[]) {
    const evidence = eye?.evidence;
    if (!evidence) continue;

    for (const key of ['map', 'front'] as const) {
      const name = evidence[key];
      if (!name) continue;
      const url = await fetchOne(name);
      if (url) evidence[key] = url;
      else delete evidence[key];
    }

    const photos: { image: string }[] = [];
    for (const photo of evidence.photos ?? []) {
      if (!photo?.image) continue;
      const url = await fetchOne(photo.image);
      if (url) photos.push({ ...photo, image: url });
    }
    evidence.photos = photos;
  }

  if (missing.length) {
    summary.evidenceIncomplete = missing;
  }
  return summary;
}

/** Every evidence render a detection points at, so a delete takes them with it. */
export function storedEvidenceUrls(
  summary: Record<string, unknown> | null,
): string[] {
  if (!summary) return [];
  const urls = new Set<string>();
  const eyes = Array.isArray(summary.eyes) ? summary.eyes : [];

  for (const eye of eyes as { evidence?: EvidenceBlock }[]) {
    const evidence = eye?.evidence;
    if (!evidence) continue;
    for (const value of [evidence.map, evidence.front]) {
      if (value?.startsWith(RENDER_PREFIX)) urls.add(value);
    }
    for (const photo of evidence.photos ?? []) {
      if (photo?.image?.startsWith(RENDER_PREFIX)) urls.add(photo.image);
    }
  }
  return [...urls];
}
