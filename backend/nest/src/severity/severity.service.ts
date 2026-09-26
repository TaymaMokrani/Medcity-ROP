import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'fs/promises';
import { basename } from 'path';
import type { Eye, Phase2Status, Severity } from '../detections/rop';

/** A photograph the doctor has uploaded but not yet committed to a screening. */
export interface UploadedImage {
  buffer: Buffer;
  originalname: string;
}

/** What the severity service says about a job in flight. */
export interface SeverityJob {
  jobId: string;
  status: Phase2Status;
  step: string;
  progress: { done: number; total: number };
  seconds: number;
  error: string | null;
}

/** The finished assessment. Kept loose on purpose: it is a nested measurement
 * record owned by the Python service, and re-declaring its shape here would only
 * let the two drift. The few fields the gateway itself reads are named. */
export interface SeverityResult extends Record<string, unknown> {
  patient: { severity: Severity; action: string; urgent?: boolean };
  eyes: SeverityEye[];
}

export interface SeverityEye extends Record<string, unknown> {
  eye: 'L' | 'R';
  severity: Severity;
  evidence: { map?: string; front?: string; photos?: { image: string }[] };
}

/** Measuring a patient takes about seventy seconds, but every call here is a
 * short one — submitting, polling, or fetching a finished result. */
const REQUEST_TIMEOUT_MS = 30_000;

/** The evidence packets run to a few megabytes, so they get longer. */
const EVIDENCE_TIMEOUT_MS = 120_000;

/**
 * The only place that talks to the Phase 2 severity service.
 *
 * Same contract as MlService: there is no local fallback. An unset or
 * unreachable service fails loudly rather than inventing a severity.
 */
@Injectable()
export class SeverityService {
  private readonly logger = new Logger(SeverityService.name);

  constructor(private readonly config: ConfigService) {}

  get configured(): boolean {
    return Boolean(this.config.get<string>('SEVERITY_SERVICE_URL'));
  }

  private baseUrl(): string {
    const url = this.config.get<string>('SEVERITY_SERVICE_URL');
    if (!url) {
      this.logger.error('SEVERITY_SERVICE_URL is not set; refusing to grade');
      throw new ServiceUnavailableException(
        'Severity analysis is not configured',
      );
    }
    return url.replace(/\/$/, '');
  }

  /**
   * Starts an analysis from files already on disk.
   *
   * Laterality is carried by which field each photograph is posted under. It is
   * never inferred from the image, here or in the service.
   */
  async start(
    imagesByEye: Partial<Record<Eye, string[]>>,
    reference: string,
  ): Promise<SeverityJob> {
    const loaded: Partial<Record<Eye, UploadedImage[]>> = {};
    for (const eye of Object.keys(imagesByEye) as Eye[]) {
      loaded[eye] = await Promise.all(
        (imagesByEye[eye] ?? []).map(async (path) => ({
          buffer: await readFile(path),
          originalname: basename(path),
        })),
      );
    }
    return this.startFromFiles(loaded, reference);
  }

  /**
   * Starts an analysis from files that are still in memory.
   *
   * This is the path the create flow uses: the doctor has uploaded photographs
   * but has not committed the screening yet, so there is nothing on disk and no
   * record to hang a job off.
   */
  async startFromFiles(
    imagesByEye: Partial<Record<Eye, UploadedImage[]>>,
    reference: string,
  ): Promise<SeverityJob> {
    const form = new FormData();
    const field: Record<Eye, string> = { Left: 'left', Right: 'right' };

    for (const eye of Object.keys(imagesByEye) as Eye[]) {
      for (const file of imagesByEye[eye] ?? []) {
        form.append(
          field[eye],
          new Blob([new Uint8Array(file.buffer)]),
          file.originalname,
        );
      }
    }
    form.append('reference', reference);

    const body = await this.call<{ job_id: string; status: string }>(
      '/analyze',
      { method: 'POST', body: form },
    );
    return {
      jobId: body.job_id,
      status: this.asStatus(body.status),
      step: 'waiting for the analyser',
      progress: { done: 0, total: 0 },
      seconds: 0,
      error: null,
    };
  }

  async status(jobId: string): Promise<SeverityJob> {
    const body = await this.call<{
      job_id: string;
      status: string;
      step: string;
      progress: { done: number; total: number };
      seconds: number;
      error: string | null;
    }>(`/jobs/${jobId}`);

    return {
      jobId: body.job_id,
      status: this.asStatus(body.status),
      step: body.step,
      progress: body.progress ?? { done: 0, total: 0 },
      seconds: body.seconds ?? 0,
      error: body.error ?? null,
    };
  }

  async result(jobId: string): Promise<SeverityResult> {
    return this.call<SeverityResult>(`/jobs/${jobId}/result`);
  }

  async evidence(jobId: string): Promise<Record<string, unknown>> {
    return this.call(`/jobs/${jobId}/evidence`, {}, EVIDENCE_TIMEOUT_MS);
  }

  /** One rendered evidence image, as bytes, so the gateway can keep its own copy. */
  async image(jobId: string, name: string): Promise<Buffer> {
    const response = await fetch(
      `${this.baseUrl()}/jobs/${jobId}/images/${encodeURIComponent(name)}`,
      { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
    );
    if (!response.ok) {
      throw new BadGatewayException(
        `Severity service could not return ${name} (${response.status})`,
      );
    }
    return Buffer.from(await response.arrayBuffer());
  }

  private asStatus(value: string): Phase2Status {
    return (['queued', 'running', 'done', 'failed'] as const).includes(
      value as never,
    )
      ? (value as Phase2Status)
      : 'failed';
  }

  private async call<T>(
    path: string,
    init: RequestInit = {},
    timeout = REQUEST_TIMEOUT_MS,
  ): Promise<T> {
    let payload: unknown;
    try {
      const response = await fetch(`${this.baseUrl()}${path}`, {
        ...init,
        signal: AbortSignal.timeout(timeout),
      });

      // The service answered and said the request was wrong. That is not an
      // outage, and reporting it as one hides the reason from the doctor.
      if (response.status >= 400 && response.status < 500) {
        const reason = await this.readRejection(response);
        this.logger.warn(`severity service rejected ${path}: ${reason}`);
        throw new BadRequestException(reason);
      }
      if (!response.ok) {
        throw new Error(`responded ${response.status}`);
      }
      payload = await response.json();
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error(`severity service unreachable: ${String(error)}`);
      throw new ServiceUnavailableException('Severity analysis is unavailable');
    }

    if (payload === null || typeof payload !== 'object') {
      throw new BadGatewayException(
        'Severity service returned an invalid result',
      );
    }
    return payload as T;
  }

  private async readRejection(response: Response): Promise<string> {
    try {
      const body = (await response.json()) as { detail?: unknown };
      const detail = body?.detail;
      if (typeof detail === 'string') return detail;
      if (detail) return JSON.stringify(detail);
    } catch {
      // not JSON; fall through to the status line
    }
    return `the analysis service refused the request (${response.status})`;
  }
}
