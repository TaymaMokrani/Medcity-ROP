import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Eye } from '../detections/rop';

export interface EyePrediction {
  risk: number;
  flagged: boolean;
  threshold: number;
  baseRate: number;
  /** Which model answered. Absent only if the service did not say. */
  modelVersion?: string;
}

export interface ClinicalInput {
  eye: Eye;
  gestationalAge: number;
  ageWeeks: number;
}

interface MlServiceResponse {
  risk: number;
  flagged: boolean;
  threshold: number;
  base_rate: number;
  model_version?: string;
}

const REQUEST_TIMEOUT_MS = 60_000;

@Injectable()
export class MlService {
  private readonly logger = new Logger(MlService.name);

  constructor(private readonly config: ConfigService) {}

  async predict(
    images: Buffer[],
    clinical: ClinicalInput,
  ): Promise<EyePrediction> {
    const serviceUrl = this.config.get<string>('ML_SERVICE_URL');
    if (!serviceUrl) {
      this.logger.error('ML_SERVICE_URL is not set; refusing to score');
      throw new ServiceUnavailableException(
        'Analysis service is not configured',
      );
    }
    return this.callMlService(serviceUrl, images, clinical);
  }

  private async callMlService(
    serviceUrl: string,
    images: Buffer[],
    clinical: ClinicalInput,
  ): Promise<EyePrediction> {
    const form = new FormData();
    images.forEach((image, index) => {
      form.append('images', new Blob([new Uint8Array(image)]), `${index}.jpg`);
    });
    form.append('eye', clinical.eye === 'Left' ? 'L' : 'R');
    form.append('gestational_age', String(clinical.gestationalAge));
    form.append('age_weeks', String(clinical.ageWeeks));

    let payload: unknown;
    try {
      const response = await fetch(`${serviceUrl.replace(/\/$/, '')}/predict`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (response.status >= 400 && response.status < 500) {
        const reason = await this.readRejection(response);
        this.logger.warn(`ML service rejected the request: ${reason}`);
        throw new BadRequestException(reason);
      }
      if (!response.ok) {
        throw new Error(`responded ${response.status}`);
      }
      payload = await response.json();
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error(`ML service unreachable: ${String(error)}`);
      throw new ServiceUnavailableException('Analysis service is unavailable');
    }

    const body = (payload ?? {}) as Partial<MlServiceResponse>;
    const usable =
      typeof body.risk === 'number' &&
      body.risk >= 0 &&
      body.risk <= 1 &&
      typeof body.flagged === 'boolean' &&
      typeof body.threshold === 'number' &&
      typeof body.base_rate === 'number';

    if (!usable) {
      this.logger.error(
        `ML service returned an unusable body: ${JSON.stringify(payload)}`,
      );
      throw new BadGatewayException(
        'Analysis service returned an invalid result',
      );
    }

    return {
      risk: body.risk!,
      flagged: body.flagged!,
      threshold: body.threshold!,
      baseRate: body.base_rate!,
      modelVersion:
        typeof body.model_version === 'string' ? body.model_version : undefined,
    };
  }

  private async readRejection(response: Response): Promise<string> {
    try {
      const body = (await response.json()) as { detail?: unknown };
      const detail = body?.detail;
      if (typeof detail === 'string') return detail;
      if (Array.isArray(detail)) {
        return detail
          .map((item: { loc?: unknown[]; msg?: string }) =>
            [item.loc?.slice(-1)?.[0], item.msg].filter(Boolean).join(': '),
          )
          .join('; ');
      }
    } catch {}
    return `The analysis service rejected the request (${response.status})`;
  }
}
