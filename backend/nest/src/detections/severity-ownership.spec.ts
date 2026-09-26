import { ForbiddenException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { DetectionsService } from './detections.service';
import { Detection } from './detection.entity';
import { Patient } from '../patients/patient.entity';
import { AccessService } from '../access/access.service';
import { AccessGrant } from '../access/access-grant.entity';
import { AuditService } from '../audit/audit.service';
import { MlService } from '../ml/ml.service';
import { SeverityService } from '../severity/severity.service';
import { StorageService } from '../storage/storage.service';

/**
 * A severity analysis started before the screening is saved has no record
 * behind it, so the usual `findOneBy({ id, ownerId })` has nothing to read.
 * For a while that meant three routes — progress, assessment, evidence
 * packets — took a job id and checked nothing at all: any signed-in doctor
 * who had a job id could read another doctor's patient.
 *
 * These tests hold that shut. The severity service throws if it is reached,
 * so a passing test also proves the check happens *before* the request goes
 * anywhere, not after the data has already been fetched.
 */

const OWNER = 'doctor-who-started-it';
const OTHER = 'doctor-who-did-not';
const JOB = 'a07210e2a4684bd08c34e2c8f5bcbe14';

function grantStore() {
  const rows = new Map<string, AccessGrant>();
  const at = (row: { kind: string; key: string }) => `${row.kind}::${row.key}`;
  return {
    findOneBy: (where: { kind: string; key: string; ownerId: string }) => {
      const row = rows.get(at(where));
      return Promise.resolve(row && row.ownerId === where.ownerId ? row : null);
    },
    delete: () => Promise.resolve({ affected: 0 }),
    createQueryBuilder: () => {
      let pending: AccessGrant[] = [];
      const builder = {
        insert: () => builder,
        into: () => builder,
        values: (values: AccessGrant[]) => ((pending = values), builder),
        orIgnore: () => builder,
        execute: () => {
          for (const value of pending) rows.set(at(value), value);
          return Promise.resolve({});
        },
      };
      return builder;
    },
  };
}

function build() {
  const access = new AccessService(
    grantStore() as unknown as Repository<AccessGrant>,
  );

  const reached = { severity: false };
  const severity = {
    status: () => {
      reached.severity = true;
      throw new Error('the severity service must not be reached');
    },
    evidence: () => {
      reached.severity = true;
      throw new Error('the severity service must not be reached');
    },
  };

  const service = new DetectionsService(
    {} as unknown as Repository<Detection>,
    {} as unknown as Repository<Patient>,
    {} as unknown as MlService,
    severity as unknown as SeverityService,
    access,
    { record: () => Promise.resolve() } as unknown as AuditService,
    {} as unknown as StorageService,
  );

  return { service, access, reached };
}

describe('severity jobs are scoped to the doctor who started them', () => {
  it('refuses progress on someone else’s job, without calling the analyser', async () => {
    const { service, access, reached } = build();
    await access.grant('job', JOB, OWNER);

    await expect(service.severityJob(JOB, OTHER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(reached.severity).toBe(false);
  });

  it('refuses an evidence packet from someone else’s job', async () => {
    const { service, access, reached } = build();
    await access.grant('job', JOB, OWNER);

    await expect(
      service.severityJobPacket(JOB, 'L-1', OTHER),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(reached.severity).toBe(false);
  });

  it('refuses a job id that was never granted to anyone', async () => {
    const { service } = build();
    await expect(service.severityJob(JOB, OWNER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('lets the doctor who started it through to the analyser', async () => {
    const { service, access, reached } = build();
    await access.grant('job', JOB, OWNER);

    // The stub throws once the check has passed, which is how we tell the
    // difference between "refused" and "allowed, then failed downstream".
    await expect(service.severityJob(JOB, OWNER)).rejects.toThrow(
      'the severity service must not be reached',
    );
    expect(reached.severity).toBe(true);
  });
});
