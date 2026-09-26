import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AuditEntry,
  type AuditAction,
  type AuditSubject,
} from './audit.entity';
import { generateId } from '../common/id';

export interface AuditInput {
  actorId: string;
  action: AuditAction;
  subjectType: AuditSubject;
  subjectId?: string | null;
  subjectLabel?: string | null;
  detail?: string | null;
}

/** The newest entries first, capped so a long history cannot be asked for whole. */
const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 200;

/**
 * The activity record.
 *
 * Two methods, on purpose. `record` appends and `list` reads; there is no
 * update, no delete, and no way to reach the repository from outside. A
 * medical record that can be quietly rewritten is worth less than no record,
 * so the absence of those methods is the feature.
 *
 * `record` never throws. An action that succeeded must not be reported as
 * failed because the log could not be written — the work is the record, the
 * log is the account of it. A failure to write is logged loudly instead.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditEntry)
    private readonly entries: Repository<AuditEntry>,
  ) {}

  async record(input: AuditInput): Promise<void> {
    try {
      await this.entries.insert({
        id: generateId('LOG'),
        actorId: input.actorId,
        action: input.action,
        subjectType: input.subjectType,
        subjectId: input.subjectId ?? null,
        subjectLabel: input.subjectLabel ?? null,
        detail: input.detail ?? null,
        at: new Date(),
      });
    } catch (error) {
      this.logger.error(
        `could not record ${input.action} by ${input.actorId}: ${String(error)}`,
      );
    }
  }

  async list(actorId: string, limit = DEFAULT_LIMIT): Promise<AuditEntry[]> {
    return this.entries.find({
      where: { actorId },
      order: { at: 'DESC' },
      take: Math.min(Math.max(1, limit), MAX_LIMIT),
    });
  }
}
