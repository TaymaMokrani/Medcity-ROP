import {
  Entity,
  Column,
  CreateDateColumn,
  PrimaryColumn,
  Index,
  JoinColumn,
  ManyToOne,
  VirtualColumn,
} from 'typeorm';
import { User } from '../users/user.entity';
import { Patient } from '../patients/patient.entity';
import type {
  DoctorDecision,
  ExaminerFindings,
  Eye,
  EyeSelection,
  IcropStages,
  Phase2Status,
  Severity,
} from './rop';

export const REQUIRED_IMAGES_PER_EYE = 5;

export interface DetectionImage {
  url: string;
  eye: Eye;
}

export interface EyeAnalysis {
  eye: Eye;
  risk: number;
  flagged: boolean;
  /**
   * The model's own operating point, as it reported it at the time.
   *
   * `flagged` is the model's answer and this is the line it drew to give it.
   * Carrying it with the result is what lets the interface say "flagged, at or
   * above 18%" instead of printing a percentage with nothing to read it
   * against — and what stops a second cut-off being invented in the UI.
   *
   * Optional: screenings recorded before this was kept have none.
   */
  threshold?: number;
  /** Which model produced this estimate, as the service reported it. Optional
   * for the same reason: older screenings never recorded it. */
  modelVersion?: string;
  images: string[];
}

@Entity('detections')
export class Detection {
  @PrimaryColumn()
  id: string;

  @Index()
  @Column('uuid')
  ownerId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'ownerId',
    foreignKeyConstraintName: 'FK_detections_owner',
  })
  owner?: User;

  @Index('IDX_detections_patient')
  @Column()
  patientId: string;

  /** RESTRICT, not CASCADE: deleting a patient must go through the service,
   * which removes each screening's photographs and grants before the row. A
   * cascade would drop the rows and leave the stored files with no owner. */
  @ManyToOne(() => Patient, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'patientId',
    foreignKeyConstraintName: 'FK_detections_patient',
  })
  patient?: Patient;

  /** Read from the patient record on every load, never stored here. A copy
   * went stale the moment the patient was renamed. */
  @VirtualColumn({
    type: 'varchar',
    query: (alias) =>
      `SELECT trim(p."firstName" || ' ' || p."lastName") FROM "patients" p WHERE p."id" = ${alias}."patientId"`,
  })
  patientName: string;

  /** The examination day. `date` in Postgres, read back as "YYYY-MM-DD". */
  @Column('date')
  date: string;

  @Column({ type: 'float', default: 0 })
  risk: number;

  @Column({ type: 'boolean', default: false })
  flagged: boolean;

  @Column('varchar')
  eye: EyeSelection;

  @Column({ type: 'text', nullable: true })
  image: string;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  images: DetectionImage[];

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  eyeResults: EyeAnalysis[];

  @Column({ type: 'text', nullable: true })
  notes: string;

  @Column({ type: 'varchar', default: 'Pending' })
  doctorDecision: DoctorDecision;

  @Column({ type: 'timestamptz', nullable: true })
  decidedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  /** The Phase 1 model that produced `risk` and `flagged`. Null for screenings
   * saved before versions were recorded — unknown, never guessed. */
  @Column({ type: 'varchar', nullable: true })
  modelVersion: string | null;

  /* ---------------------------------------------------------------------
   * Phase 2 — severity
   *
   * All of this stays null until the doctor runs the severity analysis. A
   * screening that has not been analysed is not a screening that came back
   * clear, which is why `phase2Status` starts at 'none' rather than the
   * severity starting at 'lower'.
   * ------------------------------------------------------------------ */

  @Column({ type: 'varchar', default: 'none' })
  phase2Status: Phase2Status;

  @Column({ type: 'varchar', nullable: true })
  phase2JobId: string | null;

  @Column({ type: 'text', nullable: true })
  phase2Error: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  phase2At: Date | null;

  /** The severity pipeline that produced the assessment, as it reported itself. */
  @Column({ type: 'varchar', nullable: true })
  phase2Version: string | null;

  /** Severity of the worse eye. Kept flat so list and dashboard views can sort
   * on it without opening the summary. */
  @Column({ type: 'varchar', nullable: true })
  severity: Severity | null;

  @Column({ type: 'boolean', default: false })
  severityUrgent: boolean;

  /** The assessment: per-eye grades, findings and the evidence image URLs.
   * A few kilobytes, so it travels with the detection. */
  @Column({ type: 'jsonb', nullable: true })
  phase2Summary: Record<string, unknown> | null;

  /** Where the per-photograph evidence packets are kept: one JSON object in
   * storage, `evidence/<id>.json`. Roughly 400 kB per photograph, so a
   * patient's worth runs to several megabytes — too much to keep in a row. */
  @Column({ type: 'varchar', nullable: true })
  phase2EvidenceKey: string | null;

  /** Where the packets used to live, before they moved to storage. Emptied by
   * `npm run storage:copy-from-disk`; read only as a fallback until then.
   *
   * `select: false` keeps it out of every ordinary query. Only the evidence
   * route loads it, and it asks for it by name. */
  @Column({ type: 'jsonb', nullable: true, select: false })
  phase2Evidence: Record<string, unknown> | null;

  /** ICROP stage per eye, entered by the clinician. The model does not measure
   * stage and never writes here. */
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  icropStages: IcropStages;

  /** Zone and plus as the examining clinician recorded them, per eye.
   *
   * The analyser measures these two and writes its own values into
   * `phase2Summary`. These are the doctor's, kept apart so the screen can show
   * both and say which is which. Empty until they enter something. */
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  examinerFindings: ExaminerFindings;
}
