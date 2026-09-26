import { Entity, Column, PrimaryColumn, Index } from 'typeorm';
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
  images: string[];
}

@Entity('detections')
export class Detection {
  @PrimaryColumn()
  id: string;

  @Index()
  @Column()
  ownerId: string;

  @Column()
  patientId: string;

  @Column()
  patientName: string;

  @Column()
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

  @Column({ type: 'text', nullable: true })
  decidedAt: string | null;

  @Column()
  createdAt: string;

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

  @Column({ type: 'text', nullable: true })
  phase2At: string | null;

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

  /** The per-photograph evidence packets — roughly 400 kB each, so a patient's
   * worth runs to several megabytes.
   *
   * `select: false` keeps it out of every ordinary query. A list of screenings
   * would otherwise carry tens of megabytes of vessel coordinates nobody asked
   * for. Only the evidence route loads it, and it asks for it by name. */
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
