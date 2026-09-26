import {
  BadGatewayException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MlService, type ClinicalInput } from './ml.service';

function serviceWith(env: Record<string, string | undefined>): MlService {
  return new MlService({
    get: (key: string) => env[key],
  } as unknown as ConfigService);
}

const imageA = Buffer.from('retina-image-a');
const imageB = Buffer.from('retina-image-b');
const clinical: ClinicalInput = {
  eye: 'Left',
  gestationalAge: 30,
  ageWeeks: 6,
};
function mlBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    risk: 0.71,
    flagged: true,
    threshold: 0.098,
    base_rate: 0.3546,
    eye: 'L',
    n_images_received: 5,
    n_images_used: 5,
    n_generated_views: 0,
    selected_indices: [0, 1, 2, 3, 4],
    attention: [0.2, 0.2, 0.2, 0.2, 0.2],
    model_version: 'v1-2026-08',
    reliability: 'normal',
    ...overrides,
  });
}

describe('MlService', () => {
  describe('no ML_SERVICE_URL', () => {
    it('refuses to score rather than inventing a risk', async () => {
      await expect(
        serviceWith({}).predict([imageA], clinical),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  describe('delegating to FastAPI (ML_SERVICE_URL set)', () => {
    const url = 'http://ml.internal:8000';
    const original = globalThis.fetch;
    afterEach(() => {
      globalThis.fetch = original;
    });

    it('posts to /predict and returns the risk the service reported', async () => {
      const calls: string[] = [];
      globalThis.fetch = (input: RequestInfo | URL) => {
        calls.push(input instanceof Request ? input.url : String(input));
        return Promise.resolve(new Response(mlBody(), { status: 200 }));
      };

      const prediction = await serviceWith({ ML_SERVICE_URL: url }).predict(
        [imageA],
        clinical,
      );

      expect(calls).toEqual([`${url}/predict`]);
      expect(prediction).toEqual({
        risk: 0.71,
        flagged: true,
        threshold: 0.098,
        baseRate: 0.3546,
      });
    });

    it('sends the eye and both clinical numbers, never only the images', async () => {
      let sent: FormData | undefined;
      globalThis.fetch = (_input: RequestInfo | URL, init?: RequestInit) => {
        sent = init?.body as FormData;
        return Promise.resolve(new Response(mlBody(), { status: 200 }));
      };

      await serviceWith({ ML_SERVICE_URL: url }).predict([imageA, imageB], {
        eye: 'Right',
        gestationalAge: 28.5,
        ageWeeks: 4.25,
      });

      expect(sent?.get('eye')).toBe('R');
      expect(sent?.get('gestational_age')).toBe('28.5');
      expect(sent?.get('age_weeks')).toBe('4.25');
      expect(sent?.getAll('images')).toHaveLength(2);
    });

    it('reports 503 rather than inventing a risk when the service is down', async () => {
      globalThis.fetch = () => Promise.reject(new Error('ECONNREFUSED'));

      await expect(
        serviceWith({ ML_SERVICE_URL: url }).predict([imageA], clinical),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('rejects a risk outside 0–1', async () => {
      globalThis.fetch = () =>
        Promise.resolve(new Response(mlBody({ risk: 71 }), { status: 200 }));

      await expect(
        serviceWith({ ML_SERVICE_URL: url }).predict([imageA], clinical),
      ).rejects.toBeInstanceOf(BadGatewayException);
    });

    it('rejects a body with no risk in it', async () => {
      globalThis.fetch = () =>
        Promise.resolve(
          new Response(JSON.stringify({ result: 'ROP Stage 2' }), {
            status: 200,
          }),
        );

      await expect(
        serviceWith({ ML_SERVICE_URL: url }).predict([imageA], clinical),
      ).rejects.toBeInstanceOf(BadGatewayException);
    });

    it('passes on why the service refused, instead of calling it an outage', async () => {
      globalThis.fetch = () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              detail: 'age_weeks must be between 0 and 60, got 93.7',
            }),
            { status: 422 },
          ),
        );

      await expect(
        serviceWith({ ML_SERVICE_URL: url }).predict([imageA], clinical),
      ).rejects.toThrow('age_weeks must be between 0 and 60, got 93.7');
    });

    it('treats a refusal as a bad request, not a dead service', async () => {
      globalThis.fetch = () =>
        Promise.resolve(
          new Response(JSON.stringify({ detail: 'nope' }), { status: 422 }),
        );

      await expect(
        serviceWith({ ML_SERVICE_URL: url }).predict([imageA], clinical),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('reads pydantic field errors too', async () => {
      globalThis.fetch = () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              detail: [
                { loc: ['body', 'gestational_age'], msg: 'Field required' },
              ],
            }),
            { status: 422 },
          ),
        );

      await expect(
        serviceWith({ ML_SERVICE_URL: url }).predict([imageA], clinical),
      ).rejects.toThrow('gestational_age: Field required');
    });

    it('reports a server-side failure as an outage', async () => {
      globalThis.fetch = () =>
        Promise.resolve(new Response('upstream exploded', { status: 500 }));

      await expect(
        serviceWith({ ML_SERVICE_URL: url }).predict([imageA], clinical),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });
});
