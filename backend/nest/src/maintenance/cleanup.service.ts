import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { Detection } from '../detections/detection.entity';
import { storedObjectKeys } from '../detections/detection-storage';
import { AccessGrant } from '../access/access-grant.entity';
import { AccessService } from '../access/access.service';
import { StorageService } from '../storage/storage.service';
import { JOB_PREFIX, RENDER_PREFIX, STAGING_PREFIX } from '../storage/keys';

const HOUR = 3600_000;
const DAY = 24 * HOUR;

/** How long each kind of temporary thing is kept. */
export const RETENTION = {
  /** A queued preview's photographs. A job never runs this long. */
  staging: 1 * DAY,
  /** A finished preview's assessment and packets, waiting to be saved. */
  jobs: 7 * DAY,
  /** Evidence renders no saved screening points at. */
  renders: 7 * DAY,
  /** Access to a job nobody saved. */
  jobGrants: 30 * DAY,
};

export interface CleanupReport {
  staging: number;
  jobs: number;
  renders: number;
  jobGrants: number;
}

/**
 * Removes what previews leave behind.
 *
 * A doctor can run a severity analysis and never save the screening. Its
 * photographs, renders and results are kept for a while in case they come
 * back to it, and then nobody will ever read them again. This clears them.
 *
 * It only ever deletes things that are old AND that no saved screening points
 * at. Anything a record uses is kept, whatever its age.
 */
@Injectable()
export class CleanupService {
  private readonly logger = new Logger(CleanupService.name);

  constructor(
    @InjectRepository(Detection)
    private readonly detections: Repository<Detection>,
    @InjectRepository(AccessGrant)
    private readonly grants: Repository<AccessGrant>,
    private readonly access: AccessService,
    private readonly storage: StorageService,
  ) {}

  async run(now = new Date()): Promise<CleanupReport> {
    const rows = await this.detections.find({
      select: {
        id: true,
        image: true,
        images: true,
        eyeResults: true,
        phase2Summary: true,
        phase2JobId: true,
        phase2EvidenceKey: true,
      },
    });
    const inUse = new Set(rows.flatMap(storedObjectKeys));
    const jobsInUse = new Set(
      rows.map((row) => row.phase2JobId).filter(Boolean),
    );

    const olderThan = async (prefix: string, age: number) => {
      const listed = await this.storage.list(prefix);
      return [...listed]
        .filter(([key, item]) => {
          return (
            !inUse.has(key) && now.getTime() - item.modified.getTime() > age
          );
        })
        .map(([key]) => key);
    };

    const staging = await olderThan(STAGING_PREFIX, RETENTION.staging);
    const jobs = await olderThan(JOB_PREFIX, RETENTION.jobs);
    const renders = await olderThan(RENDER_PREFIX, RETENTION.renders);

    await this.storage.remove([...staging, ...jobs, ...renders]);
    // A render that is gone must not keep a grant saying someone may read it.
    await this.access.revoke('file', renders);

    const staleGrants = await this.grants.find({
      where: {
        kind: 'job',
        createdAt: LessThan(new Date(now.getTime() - RETENTION.jobGrants)),
      },
    });
    const jobGrants = staleGrants
      .map((grant) => grant.key)
      .filter((key) => !jobsInUse.has(key));
    await this.access.revoke('job', jobGrants);

    const report = {
      staging: staging.length,
      jobs: jobs.length,
      renders: renders.length,
      jobGrants: jobGrants.length,
    };
    this.logger.log(
      `cleanup: removed ${report.staging} staged photos, ${report.jobs} preview ` +
        `results, ${report.renders} unused renders, ${report.jobGrants} old job grants`,
    );
    return report;
  }
}
