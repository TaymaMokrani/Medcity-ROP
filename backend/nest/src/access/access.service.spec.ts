import { ForbiddenException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { AccessService } from './access.service';
import { AccessGrant, type GrantKind } from './access-grant.entity';

/**
 * A repository just real enough for these tests: rows in a Map, and a query
 * builder whose `orIgnore` actually ignores duplicates.
 */
function fakeRepository() {
  const rows = new Map<string, AccessGrant>();
  const at = (grant: { kind: string; key: string }) =>
    `${grant.kind}::${grant.key}`;

  return {
    rows,
    findOneBy: (where: { kind: GrantKind; key: string; ownerId: string }) => {
      const row = rows.get(at(where));
      return Promise.resolve(row && row.ownerId === where.ownerId ? row : null);
    },
    delete: (where: { kind: GrantKind; key: { _value: string[] } }) => {
      for (const key of where.key._value) rows.delete(`${where.kind}::${key}`);
      return Promise.resolve({ affected: 0 });
    },
    createQueryBuilder: () => {
      let pending: AccessGrant[] = [];
      const builder = {
        insert: () => builder,
        into: () => builder,
        values: (values: AccessGrant[]) => {
          pending = values;
          return builder;
        },
        orIgnore: () => builder,
        execute: () => {
          for (const value of pending) {
            if (!rows.has(at(value))) rows.set(at(value), value);
          }
          return Promise.resolve({});
        },
      };
      return builder;
    },
  };
}

function service() {
  const repository = fakeRepository();
  return {
    repository,
    access: new AccessService(repository as unknown as Repository<AccessGrant>),
  };
}

const DOCTOR_A = 'doctor-a';
const DOCTOR_B = 'doctor-b';
const PHOTO = '/uploads/detections/1795000000000-123456789.jpg';

describe('AccessService', () => {
  it('lets the owner read what was granted to them', async () => {
    const { access } = service();
    await access.grant('file', PHOTO, DOCTOR_A);

    expect(await access.mayRead('file', PHOTO, DOCTOR_A)).toBe(true);
    await expect(
      access.require('file', PHOTO, DOCTOR_A),
    ).resolves.toBeUndefined();
  });

  it('refuses a second doctor the same file', async () => {
    const { access } = service();
    await access.grant('file', PHOTO, DOCTOR_A);

    expect(await access.mayRead('file', PHOTO, DOCTOR_B)).toBe(false);
    await expect(
      access.require('file', PHOTO, DOCTOR_B),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a file nobody has been granted', async () => {
    const { access } = service();
    // The file is on disk; no grant was ever written for it. It is unreadable,
    // including by the doctor who would otherwise own it. That is the safe way
    // round: a file that arrives by some route other than an upload is not
    // quietly public.
    await expect(
      access.require('file', PHOTO, DOCTOR_A),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('keeps file grants and job grants apart', async () => {
    const { access } = service();
    await access.grant('job', 'shared-id', DOCTOR_A);

    expect(await access.mayRead('job', 'shared-id', DOCTOR_A)).toBe(true);
    expect(await access.mayRead('file', 'shared-id', DOCTOR_A)).toBe(false);
  });

  it('does not fall over when the same key is granted twice', async () => {
    const { access, repository } = service();
    await access.grant('file', PHOTO, DOCTOR_A);
    await access.grant('file', PHOTO, DOCTOR_A);

    expect(repository.rows.size).toBe(1);
    expect(await access.mayRead('file', PHOTO, DOCTOR_A)).toBe(true);
  });

  it('stops serving a file once its grant is revoked', async () => {
    const { access } = service();
    await access.grant('file', PHOTO, DOCTOR_A);
    await access.revoke('file', [PHOTO]);

    expect(await access.mayRead('file', PHOTO, DOCTOR_A)).toBe(false);
  });

  it('ignores an empty grant rather than writing a row with no key', async () => {
    const { access, repository } = service();
    await access.grant('file', [''], DOCTOR_A);
    expect(repository.rows.size).toBe(0);
  });
});
