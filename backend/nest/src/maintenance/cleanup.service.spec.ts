import type { Repository } from 'typeorm';
import { CleanupService, RETENTION } from './cleanup.service';
import type { Detection } from '../detections/detection.entity';
import type { AccessGrant } from '../access/access-grant.entity';
import type { AccessService } from '../access/access.service';
import type { StorageService } from '../storage/storage.service';

const NOW = new Date('2026-09-26T03:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const DAY = 24 * 3600_000;

/** One saved screening whose evidence render must survive any age. */
const saved = {
  id: 'DET-1',
  image: 'detections/a.jpg',
  images: [{ url: 'detections/a.jpg', eye: 'Left' }],
  eyeResults: [],
  phase2Summary: { eyes: [{ evidence: { map: 'severity/kept-L_map.jpg' } }] },
  phase2JobId: 'job-saved',
  phase2EvidenceKey: 'evidence/DET-1.json',
} as unknown as Detection;

function build() {
  const objects: Record<
    string,
    Map<string, { size: number; modified: Date }>
  > = {
    'staging/': new Map([
      [
        'staging/old/L-0.jpg',
        { size: 1, modified: ago(RETENTION.staging + 1) },
      ],
      ['staging/new/L-0.jpg', { size: 1, modified: ago(60_000) }],
    ]),
    'jobs/': new Map([
      ['jobs/old/summary.json', { size: 1, modified: ago(8 * DAY) }],
      ['jobs/new/summary.json', { size: 1, modified: ago(DAY) }],
    ]),
    'severity/': new Map([
      ['severity/kept-L_map.jpg', { size: 1, modified: ago(400 * DAY) }],
      ['severity/abandoned-L_map.jpg', { size: 1, modified: ago(8 * DAY) }],
      ['severity/recent-L_map.jpg', { size: 1, modified: ago(DAY) }],
    ]),
  };

  const removed: string[] = [];
  const revoked: Record<string, string[]> = { file: [], job: [] };

  const service = new CleanupService(
    {
      find: () => Promise.resolve([saved]),
    } as unknown as Repository<Detection>,
    {
      find: () =>
        Promise.resolve([
          { kind: 'job', key: 'job-saved' },
          { kind: 'job', key: 'job-abandoned' },
        ]),
    } as unknown as Repository<AccessGrant>,
    {
      revoke: (kind: 'file' | 'job', keys: string[]) => {
        revoked[kind].push(...keys);
        return Promise.resolve();
      },
    } as unknown as AccessService,
    {
      list: (prefix: string) => Promise.resolve(objects[prefix] ?? new Map()),
      remove: (keys: string[]) => {
        removed.push(...keys);
        return Promise.resolve();
      },
    } as unknown as StorageService,
  );
  return { service, removed, revoked };
}

describe('nightly cleanup', () => {
  it('removes only what is old and used by no saved screening', async () => {
    const { service, removed } = build();
    const report = await service.run(NOW);

    expect(removed.sort()).toEqual(
      [
        'jobs/old/summary.json',
        'severity/abandoned-L_map.jpg',
        'staging/old/L-0.jpg',
      ].sort(),
    );
    expect(report).toEqual({ staging: 1, jobs: 1, renders: 1, jobGrants: 1 });
  });

  it('keeps a saved screening’s render however old it is', async () => {
    const { service, removed } = build();
    await service.run(NOW);
    expect(removed).not.toContain('severity/kept-L_map.jpg');
  });

  it('takes the grants of what it removed, and keeps those still in use', async () => {
    const { service, revoked } = build();
    await service.run(NOW);
    expect(revoked.file).toEqual(['severity/abandoned-L_map.jpg']);
    expect(revoked.job).toEqual(['job-abandoned']);
  });
});
