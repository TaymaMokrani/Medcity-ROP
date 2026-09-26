import { existsSync, mkdirSync } from 'fs';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import type { SeverityService } from '../severity/severity.service';

export const SEVERITY_UPLOAD_DIR = join(process.cwd(), 'uploads', 'severity');
export const SEVERITY_URL_PREFIX = '/uploads/severity/';

export function ensureSeverityDir(): void {
  if (!existsSync(SEVERITY_UPLOAD_DIR)) {
    mkdirSync(SEVERITY_UPLOAD_DIR, { recursive: true });
  }
}

interface EvidenceBlock {
  map?: string;
  front?: string;
  photos?: { image?: string }[];
}

/** A name the severity service produced, pinned to one file in our own folder. */
function localName(detectionId: string, name: string): string {
  return `${detectionId}-${name.replace(/[^A-Za-z0-9._-]/g, '_')}`;
}

/**
 * Copies the rendered evidence into the gateway's own uploads folder and rewrites
 * the assessment to point at it.
 *
 * The frontend talks only to the gateway, and severity jobs are held in the
 * Python service's memory and expire. Keeping our own copy means the evidence
 * outlives the job, and survives the analyser being restarted.
 *
 * Best effort per image: one that cannot be fetched is dropped from the
 * assessment rather than left as a URL that will 404 in the viewer.
 */
export async function storeEvidenceImages(
  severity: SeverityService,
  jobId: string,
  detectionId: string,
  summary: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  ensureSeverityDir();

  const eyes = Array.isArray(summary.eyes) ? summary.eyes : [];
  const missing: string[] = [];

  const fetchOne = async (name: string): Promise<string | undefined> => {
    try {
      const bytes = await severity.image(jobId, name);
      const filename = localName(detectionId, name);
      await writeFile(join(SEVERITY_UPLOAD_DIR, filename), bytes);
      return `${SEVERITY_URL_PREFIX}${filename}`;
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

/** Every evidence file a detection points at, so a delete takes them with it. */
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
      if (value?.startsWith(SEVERITY_URL_PREFIX)) urls.add(value);
    }
    for (const photo of evidence.photos ?? []) {
      if (photo?.image?.startsWith(SEVERITY_URL_PREFIX)) urls.add(photo.image);
    }
  }
  return [...urls];
}
