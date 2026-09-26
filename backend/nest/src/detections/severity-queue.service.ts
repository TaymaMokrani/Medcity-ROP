import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { JobsOptions, Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { SEVERITY_QUEUE } from '../queue/queue.constants';
import { StorageService } from '../storage/storage.service';
import { jobEvidenceKey, jobSummaryKey, stagingKey } from '../storage/keys';
import type { SeverityJob, UploadedImage } from '../severity/severity.service';
import type { Eye, Phase2Status } from './rop';

/** What a queued analysis carries. Photographs travel as storage keys, never
 * as bytes: a job in Redis stays a few hundred bytes whatever the upload. */
export interface SeverityJobData {
  ownerId: string;
  /** Passed to the analyser for its logs: a screening id, 'preview' or 'workspace'. */
  reference: string;
  /** Set when the result belongs to a saved screening; null for a preview. */
  detectionId: string | null;
  photos: Partial<Record<Eye, string[]>>;
  /** True when the photographs are temporary copies made for this job. */
  staged: boolean;
}

/** How far the analyser has got, as the worker last heard it. */
export interface SeverityJobProgress {
  step: string;
  progress: { done: number; total: number };
  seconds: number;
  analyserJobId?: string;
}

export interface SeverityJobResult {
  severity: string;
}

/** Tries before a job is given up: the first, and three retries. */
export const SEVERITY_ATTEMPTS = 4;

const JOB_OPTIONS: JobsOptions = {
  attempts: SEVERITY_ATTEMPTS,
  // 30 s, 60 s, then 120 s: three and a half minutes in all, enough for a
  // restarted analyser to load its models (about a minute) and answer.
  backoff: { type: 'exponential', delay: 30_000 },
  // Kept in Redis long enough for anyone to come back to a result, then gone.
  removeOnComplete: { age: 7 * 24 * 3600 },
  removeOnFail: { age: 30 * 24 * 3600 },
};

/**
 * Puts severity analyses on the queue and reports on them.
 *
 * Nothing here talks to the analyser. The worker (SeverityProcessor) is the
 * only thing that does; everything else asks the queue where a job has got to,
 * and reads a finished preview's result from storage.
 */
@Injectable()
export class SeverityQueueService {
  constructor(
    @InjectQueue(SEVERITY_QUEUE)
    private readonly queue: Queue<SeverityJobData, SeverityJobResult>,
    private readonly storage: StorageService,
  ) {}

  /**
   * An upload that has not been saved: its photographs are copied to staging
   * first, so the job can be retried — or picked up after a restart — without
   * the doctor uploading again.
   */
  async enqueuePreview(
    uploads: Partial<Record<Eye, UploadedImage[]>>,
    reference: string,
    ownerId: string,
  ): Promise<SeverityJob> {
    const jobId = newJobId();
    const photos: Partial<Record<Eye, string[]>> = {};

    for (const eye of Object.keys(uploads) as Eye[]) {
      photos[eye] = [];
      for (const [index, file] of (uploads[eye] ?? []).entries()) {
        const key = stagingKey(jobId, eye, index, file.originalname);
        await this.storage.put(key, file.buffer);
        photos[eye].push(key);
      }
    }

    await this.queue.add(
      'analyse',
      { ownerId, reference, detectionId: null, photos, staged: true },
      { ...JOB_OPTIONS, jobId },
    );
    return queued(jobId);
  }

  /** A saved screening: its photographs are already in storage. */
  async enqueueScreening(
    detectionId: string,
    photos: Partial<Record<Eye, string[]>>,
    ownerId: string,
  ): Promise<SeverityJob> {
    const jobId = newJobId();
    await this.queue.add(
      'analyse',
      { ownerId, reference: detectionId, detectionId, photos, staged: false },
      { ...JOB_OPTIONS, jobId },
    );
    return queued(jobId);
  }

  /** Where a job has got to, in the words the frontend already uses. Null
   * when the queue no longer knows the job (expired, or never existed). */
  async describe(jobId: string): Promise<SeverityJob | null> {
    const job = await this.queue.getJob(jobId);
    if (!job) return null;

    const state = await job.getState();
    const heard = (
      typeof job.progress === 'object' ? job.progress : {}
    ) as Partial<SeverityJobProgress>;

    const status: Phase2Status =
      state === 'completed'
        ? 'done'
        : state === 'failed'
          ? 'failed'
          : state === 'active'
            ? 'running'
            : 'queued';

    // Waiting again after a failed try: say so, rather than look stuck.
    const retrying = status === 'queued' && job.attemptsMade > 0;

    return {
      jobId,
      status,
      step: retrying
        ? `the analyser was interrupted — retrying (attempt ${job.attemptsMade + 1} of ${SEVERITY_ATTEMPTS})`
        : status === 'queued'
          ? 'waiting in the queue'
          : (heard.step ?? (status === 'done' ? 'complete' : 'starting')),
      progress: heard.progress ?? { done: 0, total: 0 },
      seconds: heard.seconds ?? 0,
      error:
        status === 'failed' ? job.failedReason || 'the analysis failed' : null,
    };
  }

  /** A finished preview's assessment, from storage. */
  async summary(jobId: string): Promise<Record<string, unknown>> {
    const bytes = await this.storage.read(jobSummaryKey(jobId));
    return JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
  }

  /** A finished preview's packets, as stored bytes. */
  async evidenceBytes(jobId: string): Promise<Buffer> {
    return this.storage.read(jobEvidenceKey(jobId));
  }

  async evidence(jobId: string): Promise<Record<string, unknown>> {
    const bytes = await this.evidenceBytes(jobId);
    return JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
  }

  /** Waiting / running / failed counts, for the health check. */
  async counts() {
    return this.queue.getJobCounts('waiting', 'active', 'delayed', 'failed');
  }
}

/** 32 hex characters, the same shape as the analyser's own ids. */
function newJobId(): string {
  return randomUUID().replace(/-/g, '');
}

function queued(jobId: string): SeverityJob {
  return {
    jobId,
    status: 'queued',
    step: 'waiting in the queue',
    progress: { done: 0, total: 0 },
    seconds: 0,
    error: null,
  };
}
