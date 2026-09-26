import { Entity, Column, PrimaryColumn, Index } from 'typeorm';

/**
 * What happened. One value per thing a doctor can do that changes a record.
 *
 * Named after the act, not the route: `conclusion.recorded` rather than
 * `detection.updated`, because the log is read by the person who did it and
 * "you updated a detection" tells them nothing.
 */
export const AUDIT_ACTIONS = [
  'patient.created',
  'patient.updated',
  'patient.deleted',
  'screening.created',
  'screening.updated',
  'screening.deleted',
  'severity.started',
  'severity.completed',
  'examiner.recorded',
  'conclusion.recorded',
  'report.exported',
  'session.opened',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditSubject = 'patient' | 'screening' | 'session';

/**
 * One line in the record of who did what.
 *
 * Append only. Nothing in this codebase updates or deletes a row here — the
 * service exposes `record` and `list` and nothing else, and there is no
 * repository handle outside it. A log that can be edited is not evidence.
 *
 * `subjectLabel` and `detail` are copies of how things read at the time, not
 * references. That is the point: when a patient is deleted their history must
 * still say whose it was, and a line that says "changed to Confirms ROP" has
 * to keep saying that after the next change. Rows never look anything up.
 */
@Entity('audit_log')
export class AuditEntry {
  @PrimaryColumn()
  id: string;

  /** The doctor who acted. Indexed because every read is "mine, newest first". */
  @Index('IDX_audit_log_actor')
  @Column('uuid')
  // No foreign key, on purpose: the log keeps its lines whatever happens to
  // the rows it mentions. Same reason the labels below are copies.
  actorId: string;

  @Column('varchar')
  action: AuditAction;

  @Column('varchar')
  subjectType: AuditSubject;

  @Column({ type: 'text', nullable: true })
  subjectId: string | null;

  /** How the subject read at the time — a patient's name, a screening's date. */
  @Column({ type: 'text', nullable: true })
  subjectLabel: string | null;

  /** One sentence saying what actually changed. Shown as the second line. */
  @Column({ type: 'text', nullable: true })
  detail: string | null;

  @Index('IDX_audit_log_at')
  @Column('timestamptz')
  at: Date;
}
