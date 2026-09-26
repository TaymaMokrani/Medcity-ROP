import { Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import { MAINTENANCE_QUEUE } from '../queue/queue.constants';
import { CleanupService, type CleanupReport } from './cleanup.service';

/** Every night at 03:00, unless CLEANUP_CRON says otherwise. */
const DEFAULT_CLEANUP_CRON = '0 3 * * *';

/**
 * Scheduled housekeeping, run through the same queue as everything else.
 *
 * The schedule is stored in Redis (a "job scheduler"), so it survives
 * restarts, and if several gateways run, the job still runs once per night,
 * not once per gateway. `upsert` means starting the app again replaces the
 * schedule instead of adding a second one.
 *
 * To watch it work without waiting for 03:00, set CLEANUP_CRON to
 * `*\/2 * * * *` (every two minutes) in .env and restart the gateway.
 */
@Processor(MAINTENANCE_QUEUE)
export class MaintenanceProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(MaintenanceProcessor.name);

  constructor(
    private readonly cleanup: CleanupService,
    private readonly config: ConfigService,
    @InjectQueue(MAINTENANCE_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    const pattern =
      this.config.get<string>('CLEANUP_CRON')?.trim() || DEFAULT_CLEANUP_CRON;
    await this.queue.upsertJobScheduler(
      'nightly-cleanup',
      { pattern },
      {
        name: 'cleanup',
        opts: { removeOnComplete: { count: 30 }, removeOnFail: { count: 30 } },
      },
    );
    this.logger.log(`cleanup scheduled: ${pattern}`);
  }

  async process(job: Job): Promise<CleanupReport | undefined> {
    if (job.name === 'cleanup') return this.cleanup.run();
    this.logger.warn(`unknown maintenance job ${job.name}`);
    return undefined;
  }
}
