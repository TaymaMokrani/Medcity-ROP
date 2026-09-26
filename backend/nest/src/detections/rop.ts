export const EYES = ['Left', 'Right'] as const;
export type Eye = (typeof EYES)[number];

export const EYE_SELECTIONS = ['Left', 'Right', 'Both'] as const;
export type EyeSelection = (typeof EYE_SELECTIONS)[number];

export const DOCTOR_DECISIONS = [
  'Pending',
  'Confirms ROP',
  'No ROP',
  'Uncertain',
] as const;
export type DoctorDecision = (typeof DOCTOR_DECISIONS)[number];

export function eyesFor(selection: EyeSelection): Eye[] {
  return selection === 'Both' ? ['Left', 'Right'] : [selection];
}

/* -------------------------------------------------------------------------
 * Phase 2 — severity
 *
 * Phase 1 answers whether an eye has ROP. Everything below describes how bad
 * it is and how soon it needs treating, and none of it exists until the
 * severity analysis has actually run. `unknown` is a real answer, not a
 * missing one: it means the eye could not be fully measured, which is not the
 * same as the eye being normal.
 * ---------------------------------------------------------------------- */

export const SEVERITIES = [
  'lower',
  'intermediate',
  'severe',
  'unknown',
] as const;
export type Severity = (typeof SEVERITIES)[number];

/** Where a screening is in the severity pipeline. */
export const PHASE2_STATUSES = [
  'none',
  'queued',
  'running',
  'done',
  'failed',
] as const;
export type Phase2Status = (typeof PHASE2_STATUSES)[number];

/** Plus disease. `null` means it could not be assessed, never that it is absent. */
export const PLUS_GRADES = ['normal', 'pre-plus', 'plus'] as const;
export type PlusGrade = (typeof PLUS_GRADES)[number];

/**
 * ICROP stage, entered by the examining clinician.
 *
 * The severity model measures zone and plus disease. It does not measure stage:
 * staging depends on the demarcation line, the ridge and neovascularisation,
 * and nothing in the pipeline detects them. So this is the doctor's value and
 * is labelled as theirs wherever it is shown.
 */
export const ICROP_STAGES = [0, 1, 2, 3, 4, 5] as const;
export type IcropStage = (typeof ICROP_STAGES)[number];

/** One eye's stage, as the clinician recorded it. */
export type IcropStages = Partial<Record<Eye, IcropStage>>;

/** Severity ranked, so the worse eye can headline a screening. */
const SEVERITY_RANK: Record<Severity, number> = {
  unknown: -1,
  lower: 0,
  intermediate: 1,
  severe: 2,
};

export function worseSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[b] > SEVERITY_RANK[a] ? b : a;
}

/* -------------------------------------------------------------------------
 * The examiner's own record
 *
 * The pipeline measures zone and plus disease and cannot measure stage. That
 * split is a fact about today's models, not about ophthalmology, and it is
 * about to change: a stage model is being built. So the examiner's findings
 * are stored on the same three axes the analyser reports, each one optional
 * and each one plainly theirs.
 *
 * Where both exist they are shown side by side and never merged. A machine
 * value that quietly overwrote a doctor's entry — or the reverse — would make
 * the record unreadable afterwards.
 * ---------------------------------------------------------------------- */

export const ZONES = ['1', '2', '3'] as const;
export type Zone = (typeof ZONES)[number];

export interface ExaminerFinding {
  zone?: Zone | null;
  plus?: PlusGrade | null;
}

export type ExaminerFindings = Partial<Record<Eye, ExaminerFinding>>;
