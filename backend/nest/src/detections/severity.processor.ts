import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { UnrecoverableError, type Job } from 'bullmq';
import { basename } from 'path';
import { Repository } from 'typeorm';
import { SEVERITY_QUEUE } from '../queue/queue.constants';
import {
  SeverityService,
  type SeverityJob,
  type UploadedImage,
} from '../severity/severity.service';
import { StorageService } from '../storage/storage.service';
import {
  evidenceKey,
  isOwnedKey,
  jobEvidenceKey,
  jobSummaryKey,
  STAGING_PREFIX,
} from '../storage/keys';
import { AccessService } from '../access/access.service';
import { AuditService } from '../audit/audit.service';
import { Detection } from './detection.entity';
import { storeEvidenceImages, storedEvidenceUrls } from './severity-storage';
import type { Eye, Severity } from './rop';
import {
  SEVERITY_ATTEMPTS,
  type SeverityJobData,
  type SeverityJobProgress,
  type SeverityJobResult,
} from './severity-queue.service';

/** How often the worker asks the analyser where it has got to. */
const POLL_MS = 2_000;

/** A patient takes about seventy seconds. Ten minutes means something is stuck. */
const MAX_ANALYSIS_MS = 10 * 60_000;

/**
 * The worker: takes severity analyses off the queue, one at a time.
 *
 * One at a time because both segmentation models and the matcher share one
 * GPU; two patients at once would not be faster, only closer to running out of
 * memory.
 *
 * It is the only code that talks to the analyser. For each job it sends the
 * photographs, follows the analysis, and when it finishes keeps everything —
 * assessment, renders, packets — in storage and, for a saved screening, in
 * the database. The result is durable the moment the analysis ends, whether or
 * not anyone is looking.
 *
 * Two kinds of failure, treated differently:
 *   - the analyser was unreachable, restarted, or lost the job: thrown as an
 *     ordinary error, so the queue retries it (SEVERITY_ATTEMPTS tries in all);
 *   - the analyser looked at the photographs and refused them: thrown as
 *     UnrecoverableError, because trying the same photographs again would
 *     only get the same answer.
 */
@Processor(SEVERITY_QUEUE, { concurrency: 1, maxStalledCount: 2 })
export class SeverityProcessor extends WorkerHost {
  private readonly logger = new Logger(SeverityProcessor.name);

  constructor(
    private readonly severity: SeverityService,
    private readonly storage: StorageService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    @InjectRepository(Detection)
    private readonly detections: Repository<Detection>,
  ) {
    super();
  }

  async process(
    job: Job<SeverityJobData, SeverityJobResult>,
  ): Promise<SeverityJobResult> {
    const { data } = job;
    const jobId = job.id as string;

    if (data.detectionId) {
      const found = await this.detections.update(
        { id: data.detectionId, ownerId: data.ownerId },
        { phase2Status: 'running', phase2Error: null },
      );
      if (!found.affected) {
        throw new UnrecoverableError('the screening was deleted');
      }
    }

    const uploads = await this.readPhotos(data.photos);
    const analyserJobId = await this.submit(uploads, data.reference);
    await this.follow(job, analyserJobId);

    // Finished. Keep everything before anything else can go wrong.
    const summary = (await this.severity.result(
      analyserJobId,
    )) as unknown as Record<string, unknown>;
    await storeEvidenceImages(
      this.storage,
      this.severity,
      analyserJobId,
      jobId,
      summary,
    );
    await this.access.grant('file', storedEvidenceUrls(summary), data.ownerId);
    const packets = await this.severity
      .evidence(analyserJobId)
      .catch((error) => {
        // The packets only drive the overlay viewer. Losing them must not lose
        // the grading.
        this.logger.warn(
          `packets unavailable for job ${jobId}: ${String(error)}`,
        );
        return null;
      });

    const patient = (summary.patient ?? {}) as {
      severity?: Severity;
      urgent?: boolean;
    };
    const severity = patient.severity ?? 'unknown';

    if (data.detectionId) {
      await this.completeScreening(data, summary, packets, severity, patient);
    } else {
      await this.storage.put(jobSummaryKey(jobId), JSON.stringify(summary));
      if (packets) {
        await this.storage.put(jobEvidenceKey(jobId), JSON.stringify(packets));
      }
    }

    await this.dropStaged(data);
    return { severity };
  }

  /** The job has failed a try. On the last one, the screening says so. */
  @OnWorkerEvent('failed')
  async onFailed(
    job: Job<SeverityJobData, SeverityJobResult> | undefined,
    error: Error,
  ): Promise<void> {
    if (!job) return;
    const final =
      error instanceof UnrecoverableError ||
      error?.name === 'UnrecoverableError' ||
      job.attemptsMade >= (job.opts.attempts ?? SEVERITY_ATTEMPTS);

    if (!final) {
      this.logger.warn(
        `severity job ${job.id} failed (try ${job.attemptsMade} of ` +
          `${job.opts.attempts ?? SEVERITY_ATTEMPTS}), will retry: ${error?.message}`,
      );
      if (job.data.detectionId) {
        await this.detections.update(
          { id: job.data.detectionId, ownerId: job.data.ownerId },
          { phase2Status: 'queued' },
        );
      }
      return;
    }

    this.logger.error(
      `severity job ${job.id} failed for good: ${error?.message}`,
    );
    if (job.data.detectionId) {
      await this.detections.update(
        { id: job.data.detectionId, ownerId: job.data.ownerId },
        {
          phase2Status: 'failed',
          phase2Error: error?.message || 'the analysis failed',
          phase2At: new Date(),
        },
      );
    }
    await this.dropStaged(job.data);
  }

  private async readPhotos(
    photos: Partial<Record<Eye, string[]>>,
  ): Promise<Partial<Record<Eye, UploadedImage[]>>> {
    const uploads: Partial<Record<Eye, UploadedImage[]>> = {};
    try {
      for (const eye of Object.keys(photos) as Eye[]) {
        uploads[eye] = await Promise.all(
          (photos[eye] ?? []).map(async (key) => ({
            buffer: await this.storage.read(key),
            originalname: basename(key),
          })),
        );
      }
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw new UnrecoverableError('the photographs are no longer stored');
      }
      throw error;
    }
    return uploads;
  }

  private async submit(
    uploads: Partial<Record<Eye, UploadedImage[]>>,
    reference: string,
  ): Promise<string> {
    try {
      const started = await this.severity.startFromFiles(uploads, reference);
      return started.jobId;
    } catch (error) {
      // The analyser read the request and refused it: the photographs, not
      // the service, are the problem.
      if (error instanceof BadRequestException) {
        throw new UnrecoverableError(error.message);
      }
      throw error;
    }
  }

  /** Polls the analyser until it finishes, reporting progress to the queue. */
  private async follow(
    job: Job<SeverityJobData, SeverityJobResult>,
    analyserJobId: string,
  ): Promise<void> {
    const deadline = Date.now() + MAX_ANALYSIS_MS;

    for (;;) {
      await sleep(POLL_MS);

      let status: SeverityJob;
      try {
        status = await this.severity.status(analyserJobId);
      } catch (error) {
        // A 4xx here means the analyser no longer knows the job — it was
        // restarted and its memory went with it. Worth another try.
        if (error instanceof BadRequestException) {
          throw new Error(
            'the analyser lost this job (it was probably restarted)',
          );
        }
        throw error;
      }

      const progress: SeverityJobProgress = {
        step: status.step,
        progress: status.progress,
        seconds: status.seconds,
        analyserJobId,
      };
      await job.updateProgress(progress);

      if (status.status === 'done') return;
      if (status.status === 'failed') {
        throw new UnrecoverableError(status.error ?? 'the analysis failed');
      }
      if (Date.now() > deadline) {
        throw new Error('the analysis took longer than ten minutes');
      }
    }
  }

  private async completeScreening(
    data: SeverityJobData,
    summary: Record<string, unknown>,
    packets: Record<string, unknown> | null,
    severity: Severity,
    patient: { urgent?: boolean },
  ): Promise<void> {
    const detectionId = data.detectionId as string;
    let packetsKey: string | null = null;
    if (packets) {
      packetsKey = evidenceKey(detectionId);
      await this.storage.put(packetsKey, JSON.stringify(packets));
    }

    const detection = await this.detections.findOneBy({
      id: detectionId,
      ownerId: data.ownerId,
    });
    if (!detection) {
      // Deleted while it was being measured. Nothing to write the result to,
      // and the packets just stored belong to nobody.
      if (packetsKey) await this.storage.remove([packetsKey]);
      throw new UnrecoverableError('the screening was deleted');
    }

    detection.phase2Summary = summary;
    detection.phase2EvidenceKey = packetsKey;
    detection.phase2Evidence = null;
    detection.severity = severity;
    detection.severityUrgent = Boolean(patient.urgent);
    detection.phase2Status = 'done';
    detection.phase2Error = null;
    detection.phase2At = new Date();
    detection.phase2Version =
      typeof summary.pipeline_version === 'string'
        ? summary.pipeline_version
        : null;
    const saved = await this.detections.save(detection);

    await this.audit.record({
      actorId: data.ownerId,
      action: 'severity.completed',
      subjectType: 'screening',
      subjectId: detectionId,
      subjectLabel: `${saved.patientName} — ${saved.date}`,
      detail: `Severity analysis finished — ${severity}`,
    });
  }

  /** A preview's temporary copies go once they are no longer needed. */
  private async dropStaged(data: SeverityJobData): Promise<void> {
    if (!data.staged) return;
    const keys = Object.values(data.photos)
      .flat()
      .filter(
        (key): key is string =>
          typeof key === 'string' &&
          key.startsWith(STAGING_PREFIX) &&
          isOwnedKey(key),
      );
    await this.storage.remove(keys).catch((error) => {
      // The nightly cleanup will get them.
      this.logger.warn(`could not drop staged photos: ${String(error)}`);
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}
