import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { StorageService } from './storage/storage.service';
import { SeverityQueueService } from './detections/severity-queue.service';

type Check = { status: 'up' } | { status: 'down'; error: string };

/**
 * Is the gateway able to do its job?
 *
 * Asks each thing it depends on — the database, object storage, the job
 * queue — and answers 200 only when all three respond. Otherwise 503, with
 * which one failed. A monitor, a load balancer or Docker can read this to
 * decide whether to send traffic here, which "status: ok" hard-coded could
 * never tell them.
 *
 * Public on purpose, and says nothing about patients: only up or down, and the
 * number of analyses waiting.
 */
@ApiTags('health')
@Controller()
export class AppController {
  constructor(
    private readonly db: DataSource,
    private readonly storage: StorageService,
    private readonly severityQueue: SeverityQueueService,
  ) {}

  @Get('health')
  async health(@Res({ passthrough: true }) response: Response) {
    const [database, storage, queue] = await Promise.all([
      check(() => this.db.query('SELECT 1')),
      check(() => this.storage.ping()),
      check(() => this.severityQueue.counts()),
    ]);

    const jobs =
      queue.status === 'up'
        ? await this.severityQueue.counts().catch(() => null)
        : null;

    const body = {
      status: [database, storage, queue].every((c) => c.status === 'up')
        ? 'ok'
        : 'degraded',
      timestamp: new Date().toISOString(),
      checks: { database, storage, queue },
      severityJobs: jobs,
    };

    if (body.status !== 'ok') response.status(HttpStatus.SERVICE_UNAVAILABLE);
    return body;
  }
}

async function check(probe: () => Promise<unknown>): Promise<Check> {
  try {
    await withTimeout(probe(), 3_000);
    return { status: 'up' };
  } catch (error) {
    return {
      status: 'down',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`no answer within ${ms} ms`)), ms),
    ),
  ]);
}
