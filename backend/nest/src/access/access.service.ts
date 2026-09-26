import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AccessGrant, type GrantKind } from './access-grant.entity';

/**
 * The one place that decides who may read a file or poll a job.
 *
 * Deliberately narrow. It answers a yes/no question and records the answer's
 * basis; it knows nothing about screenings, patients or photographs. Anything
 * that writes a file is expected to grant it in the same breath, because a
 * file nobody has been granted is unreadable — including by the doctor who
 * uploaded it.
 */
@Injectable()
export class AccessService {
  private readonly logger = new Logger(AccessService.name);

  constructor(
    @InjectRepository(AccessGrant)
    private readonly grants: Repository<AccessGrant>,
  ) {}

  /** Records that `ownerId` may read these keys. Re-granting is harmless. */
  async grant(
    kind: GrantKind,
    keys: string | string[],
    ownerId: string,
  ): Promise<void> {
    const list = [
      ...new Set((Array.isArray(keys) ? keys : [keys]).filter(Boolean)),
    ];
    if (!list.length) return;

    await this.grants
      .createQueryBuilder()
      .insert()
      .into(AccessGrant)
      .values(
        list.map((key) => ({
          kind,
          key,
          ownerId,
          createdAt: new Date(),
        })),
      )
      // A preview analysis that the doctor later saves reuses the very files
      // they were already looking at, so the same key is granted twice to the
      // same owner. That is the normal path, not a conflict.
      .orIgnore()
      .execute();
  }

  async mayRead(
    kind: GrantKind,
    key: string,
    ownerId: string,
  ): Promise<boolean> {
    const grant = await this.grants.findOneBy({ kind, key, ownerId });
    return Boolean(grant);
  }

  /**
   * Throws unless this user owns the key.
   *
   * `ForbiddenException` rather than `NotFoundException`: the caller is asking
   * about something they named themselves, so nothing is revealed by saying
   * no plainly, and a 403 is far easier to debug than a 404 that means two
   * different things.
   */
  async require(kind: GrantKind, key: string, ownerId: string): Promise<void> {
    if (await this.mayRead(kind, key, ownerId)) return;
    this.logger.warn(`refused ${kind} ${key} to ${ownerId}`);
    throw new ForbiddenException('This is not yours to read');
  }

  /** Drops grants for things that no longer exist, so the table follows the data. */
  async revoke(kind: GrantKind, keys: string[]): Promise<void> {
    const list = [...new Set(keys.filter(Boolean))];
    if (!list.length) return;
    await this.grants.delete({ kind, key: In(list) });
  }
}
