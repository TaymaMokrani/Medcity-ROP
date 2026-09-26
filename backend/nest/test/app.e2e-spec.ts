import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { HttpExceptionFilter } from './../src/common/http-exception.filter';
import { MlService } from './../src/ml/ml.service';

const TEST_CONFIG: Record<string, string> = {
  DATABASE_URL: 'pglite',
  JWT_SECRET: 'e2e-secret-long-enough-to-satisfy-validation',
  JWT_EXPIRES_IN: '1h',
  CORS_ORIGINS: 'http://localhost:3000',
};

const testConfigService = {
  get: (key: string) => TEST_CONFIG[key],
  getOrThrow: (key: string) => {
    const value = TEST_CONFIG[key];
    if (value === undefined) throw new Error(`Missing config: ${key}`);
    return value;
  },
} as unknown as ConfigService;

function body<T>(res: { body: unknown }): T {
  return res.body as T;
}

interface Identified {
  id: string;
  ownerId: string;
}

interface PatientBody extends Identified {
  firstName: string;
  dateOfBirth: string;
}

interface EyeResultBody {
  eye: string;
  risk: number;
  flagged: boolean;
}

interface DetectionBody extends Identified {
  risk: number;
  flagged: boolean;
  doctorDecision: string;
  decidedAt: string | null;
  eyeResults: EyeResultBody[];
  images: unknown[];
}

interface ErrorBody {
  message: string;
  timestamp: string;
}

const IMAGE_A = Buffer.from('fake-retina-a');
const IMAGE_B = Buffer.from('fake-retina-b');

const STUB_RISK: Record<string, number> = { Left: 0.3, Right: 0.8 };

function stubPrediction(clinical: { eye: string }) {
  const risk = STUB_RISK[clinical.eye] ?? 0.3;
  return Promise.resolve({
    risk,
    flagged: risk >= 0.098,
    threshold: 0.098,
    baseRate: 0.3546,
  });
}

const stubMlService = {
  predict: (_images: Buffer[], clinical: { eye: string }) =>
    stubPrediction(clinical),
  predictFromPaths: (_paths: string[], clinical: { eye: string }) =>
    stubPrediction(clinical),
};

const attach = (
  req: request.Test,
  field: string,
  buf: Buffer,
  name: string,
) => {
  for (let i = 0; i < REQUIRED_IMAGES; i++) {
    req = req.attach(field, Buffer.concat([buf, Buffer.from(`-${i}`)]), {
      filename: `${i}-${name}`,
      contentType: 'image/jpeg',
    });
  }
  return req;
};

const REQUIRED_IMAGES = 5;

describe('Gateway (e2e)', () => {
  let app: INestApplication<App>;
  let http: App;

  let tokenA: string;
  let tokenB: string;
  let patientA: string;
  let detectionA: string;
  let examDate: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ConfigService)
      .useValue(testConfigService)
      .overrideProvider(MlService)
      .useValue(stubMlService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    http = app.getHttpServer();

    const register = async (email: string) => {
      const res = await request(http)
        .post('/api/auth/register')
        .send({ name: `Dr ${email}`, email, password: 'secret123' })
        .expect(201);
      return body<{ token: string }>(res).token;
    };

    tokenA = await register('a@e2e.test');
    tokenB = await register('b@e2e.test');

    examDate = new Date().toISOString().split('T')[0];
    const dateOfBirth = new Date(
      Date.parse(examDate) - 6 * 7 * 24 * 60 * 60 * 1000,
    )
      .toISOString()
      .split('T')[0];

    const patient = await request(http)
      .post('/api/patients')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        firstName: 'Baseline',
        lastName: 'Case',
        dateOfBirth,
        gender: 'Female',
        gestationalAge: 30,
        birthWeight: 1200,
        motherName: 'X',
        status: 'Active',
      })
      .expect(201);
    patientA = body<PatientBody>(patient).id;

    const screening = await attach(
      request(http)
        .post('/api/detections')
        .set('Authorization', `Bearer ${tokenA}`)
        .field('eye', 'Left')
        .field('patientId', patientA)
        .field('patientName', 'Baseline Case')
        .field('date', examDate)
        .field('notes', 'baseline screening for this suite'),
      'leftImages',
      IMAGE_A,
      'a.jpg',
    ).expect(201);
    detectionA = body<DetectionBody>(screening).id;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  describe('health', () => {
    it('answers without a token', async () => {
      const res = await request(http).get('/api/health').expect(200);
      expect(body<{ status: string }>(res).status).toBe('ok');
    });
  });

  describe('authentication', () => {
    it('rejects an unauthenticated request', () =>
      request(http).get('/api/patients').expect(401));

    it('rejects a garbage token', () =>
      request(http)
        .get('/api/patients')
        .set('Authorization', 'Bearer not.a.token')
        .expect(401));

    it('rejects wrong credentials with 401, not a server error', () =>
      request(http)
        .post('/api/auth/login')
        .send({ email: 'a@e2e.test', password: 'wrong-password' })
        .expect(401));

    it('refuses a duplicate registration with 409', () =>
      request(http)
        .post('/api/auth/register')
        .send({ name: 'Impostor', email: 'a@e2e.test', password: 'secret123' })
        .expect(409));
  });

  describe('per-doctor isolation', () => {
    it('keeps each doctor to their own records', async () => {
      const [a, b] = await Promise.all([
        request(http)
          .get('/api/patients')
          .set('Authorization', `Bearer ${tokenA}`),
        request(http)
          .get('/api/patients')
          .set('Authorization', `Bearer ${tokenB}`),
      ]);
      expect(body<PatientBody[]>(a).map((p) => p.id)).toContain(patientA);
      expect(body<PatientBody[]>(b)).toHaveLength(0);
      const overlap = body<PatientBody[]>(a).filter((p) =>
        body<PatientBody[]>(b).some((q) => q.id === p.id),
      );
      expect(overlap).toHaveLength(0);
    });

    it("hides another doctor's patient behind a 404, not a 403", () =>
      request(http)
        .get(`/api/patients/${patientA}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404));

    it("refuses to update another doctor's patient", () =>
      request(http)
        .put(`/api/patients/${patientA}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ firstName: 'Hacked' })
        .expect(404));

    it("refuses to delete another doctor's patient", () =>
      request(http)
        .delete(`/api/patients/${patientA}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404));

    it("hides another doctor's detection", () =>
      request(http)
        .get(`/api/detections/${detectionA}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404));

    it("returns nothing when filtering by another doctor's patient", async () => {
      const res = await request(http)
        .get(`/api/detections?patientId=${patientA}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);
      expect(body<unknown[]>(res)).toEqual([]);
    });

    it("leaves the owner's record untouched after all of that", async () => {
      const res = await request(http)
        .get(`/api/patients/${patientA}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(body<PatientBody>(res).firstName).not.toBe('Hacked');
    });

    it('cannot be told which doctor owns a new record', async () => {
      const me = await request(http)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      const created = await request(http)
        .post('/api/patients')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          ownerId: body<Identified>(me).id,
          firstName: 'Injected',
          lastName: 'X',
          dateOfBirth: '2025-01-01',
          gender: 'Male',
          gestationalAge: 30,
          birthWeight: 1200,
          motherName: 'X',
          status: 'Active',
        })
        .expect(201);

      expect(body<PatientBody>(created).ownerId).not.toBe(
        body<Identified>(me).id,
      );

      const seenByA = await request(http)
        .get('/api/patients')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(
        body<PatientBody[]>(seenByA).some((p) => p.firstName === 'Injected'),
      ).toBe(false);
    });
  });

  describe('the verdict comes from the server', () => {
    it('scores a preview without storing anything', async () => {
      const res = await attach(
        request(http)
          .post('/api/detections/analyze')
          .set('Authorization', `Bearer ${tokenA}`)
          .field('eye', 'Left')
          .field('patientId', patientA)
          .field('date', examDate),
        'leftImages',
        IMAGE_A,
        'a.jpg',
      ).expect(201);

      expect(body<DetectionBody>(res).eyeResults).toHaveLength(1);
      expect(body<DetectionBody>(res).eyeResults[0].eye).toBe('Left');
    });

    it('ignores a verdict the client tries to dictate', async () => {
      const preview = await attach(
        request(http)
          .post('/api/detections/analyze')
          .set('Authorization', `Bearer ${tokenA}`)
          .field('eye', 'Left')
          .field('patientId', patientA)
          .field('date', examDate),
        'leftImages',
        IMAGE_A,
        'a.jpg',
      ).expect(201);

      const saved = await attach(
        request(http)
          .post('/api/detections')
          .set('Authorization', `Bearer ${tokenA}`)
          .field('eye', 'Left')
          .field('patientId', patientA)
          .field('patientName', 'Test')
          .field('date', examDate)
          .field('notes', 'x')
          .field('risk', '1')
          .field('result', 'ROP Stage 3'),
        'leftImages',
        IMAGE_A,
        'a.jpg',
      ).expect(201);

      expect(body<DetectionBody>(saved).risk).toBe(
        body<DetectionBody>(preview).eyeResults[0].risk,
      );
      expect(body<DetectionBody>(saved)).not.toHaveProperty('result');
      expect(JSON.stringify(body(saved))).not.toContain('Stage');
    });

    it('headlines a two-eye screening with the worse eye', async () => {
      const res = await attach(
        attach(
          request(http)
            .post('/api/detections')
            .set('Authorization', `Bearer ${tokenA}`)
            .field('eye', 'Both')
            .field('patientId', patientA)
            .field('patientName', 'Test')
            .field('date', examDate)
            .field('notes', 'x'),
          'leftImages',
          IMAGE_A,
          'a.jpg',
        ),
        'rightImages',
        IMAGE_B,
        'b.jpg',
      ).expect(201);

      expect(body<DetectionBody>(res).eyeResults).toHaveLength(2);
      expect(body<DetectionBody>(res).risk).toBe(
        Math.max(...body<DetectionBody>(res).eyeResults.map((r) => r.risk)),
      );
    });

    it('stores images and per-eye verdicts as real arrays', async () => {
      const res = await request(http)
        .get('/api/detections')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      const withImages = body<DetectionBody[]>(res).find(
        (d) => d.images.length,
      );
      expect(Array.isArray(withImages?.images)).toBe(true);
      expect(Array.isArray(withImages?.eyeResults)).toBe(true);
    });

    it('starts every screening with the decision left to the doctor', async () => {
      const res = await request(http)
        .get('/api/detections')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(body<DetectionBody[]>(res)[0].doctorDecision).toBe('Pending');
    });

    it('records the doctor having the last word, and when', async () => {
      const res = await request(http)
        .put(`/api/detections/${detectionA}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ doctorDecision: 'Confirms ROP' })
        .expect(200);

      expect(body<DetectionBody>(res).doctorDecision).toBe('Confirms ROP');
      expect(typeof body<DetectionBody>(res).decidedAt).toBe('string');
    });

    it('refuses a screening with fewer than five images', () =>
      request(http)
        .post('/api/detections')
        .set('Authorization', `Bearer ${tokenA}`)
        .field('eye', 'Left')
        .field('patientId', patientA)
        .field('patientName', 'Test')
        .field('date', examDate)
        .field('notes', 'x')
        .attach('leftImages', IMAGE_A, {
          filename: 'a.jpg',
          contentType: 'image/jpeg',
        })
        .expect(400));

    it('refuses to screen a baby older than the model has ever seen', async () => {
      const created = await request(http)
        .post('/api/patients')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          firstName: 'Too',
          lastName: 'Old',
          dateOfBirth: '2020-01-01',
          gender: 'Male',
          gestationalAge: 30,
          birthWeight: 1200,
          motherName: 'X',
          status: 'Active',
        })
        .expect(201);

      const res = await attach(
        request(http)
          .post('/api/detections/analyze')
          .set('Authorization', `Bearer ${tokenA}`)
          .field('eye', 'Left')
          .field('patientId', body<PatientBody>(created).id)
          .field('date', '2026-08-19'),
        'leftImages',
        IMAGE_A,
        'a.jpg',
      ).expect(400);

      expect(body<ErrorBody>(res).message).toContain('weeks old');
    });

    it('refuses to screen a patient it cannot read a gestational age for', () =>
      attach(
        request(http)
          .post('/api/detections/analyze')
          .set('Authorization', `Bearer ${tokenA}`)
          .field('eye', 'Left')
          .field('patientId', 'PAT-does-not-exist')
          .field('date', examDate),
        'leftImages',
        IMAGE_A,
        'a.jpg',
      ).expect(400));

    it('refuses a screening with no image for a selected eye', () =>
      request(http)
        .post('/api/detections')
        .set('Authorization', `Bearer ${tokenA}`)
        .field('eye', 'Left')
        .field('patientId', patientA)
        .field('patientName', 'Test')
        .field('date', examDate)
        .field('notes', 'x')
        .expect(400));
  });

  describe('validation', () => {
    it('rejects an unknown doctor decision on update', () =>
      request(http)
        .put(`/api/detections/${detectionA}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ doctorDecision: 'banana' })
        .expect(400));

    it('rejects an unknown eye selection', () =>
      request(http)
        .post('/api/detections/analyze')
        .set('Authorization', `Bearer ${tokenA}`)
        .field('eye', 'Middle')
        .field('patientId', patientA)
        .field('date', examDate)
        .expect(400));

    it('returns errors in one consistent shape', async () => {
      const res = await request(http)
        .put(`/api/detections/${detectionA}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ doctorDecision: 'banana' })
        .expect(400);

      expect(body<ErrorBody>(res)).toMatchObject({
        statusCode: 400,
        path: `/api/detections/${detectionA}`,
      });
      expect(typeof body<ErrorBody>(res).message).toBe('string');
      expect(typeof body<ErrorBody>(res).timestamp).toBe('string');
    });
  });

  describe('cascading deletes', () => {
    it("removes a patient's screenings along with the patient", async () => {
      const created = await request(http)
        .post('/api/patients')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          firstName: 'Cascade',
          lastName: 'Test',
          dateOfBirth: new Date(
            Date.parse(examDate) - 6 * 7 * 24 * 60 * 60 * 1000,
          )
            .toISOString()
            .split('T')[0],
          gender: 'Female',
          gestationalAge: 29,
          birthWeight: 1100,
          motherName: 'X',
          status: 'Active',
        })
        .expect(201);
      const patientId = body<PatientBody>(created).id;

      await request(http)
        .post('/api/detections')
        .set('Authorization', `Bearer ${tokenA}`)
        .field('eye', 'Left')
        .field('patientId', patientId)
        .field('patientName', 'Cascade Test')
        .field('date', examDate)
        .field('notes', 'x')
        .attach('leftImages', IMAGE_A, {
          filename: '0.jpg',
          contentType: 'image/jpeg',
        })
        .attach('leftImages', IMAGE_B, {
          filename: '1.jpg',
          contentType: 'image/jpeg',
        })
        .attach('leftImages', IMAGE_A, {
          filename: '2.jpg',
          contentType: 'image/jpeg',
        })
        .attach('leftImages', IMAGE_B, {
          filename: '3.jpg',
          contentType: 'image/jpeg',
        })
        .attach('leftImages', IMAGE_A, {
          filename: '4.jpg',
          contentType: 'image/jpeg',
        })
        .expect(201);

      const before = await request(http)
        .get(`/api/detections?patientId=${patientId}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(body<DetectionBody[]>(before)).toHaveLength(1);

      await request(http)
        .delete(`/api/patients/${patientId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      const after = await request(http)
        .get(`/api/detections?patientId=${patientId}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(body<DetectionBody[]>(after)).toEqual([]);
    });
  });
});
