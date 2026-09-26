import { apiGet, apiPost, apiPut } from "./api";
import type { Eye } from "./detections";

/**
 * Phase 2 — how severe an eye is, and how soon it needs treating.
 *
 * Phase 1 answers whether an eye has ROP. Nothing here exists until the doctor
 * runs the severity analysis, and `unknown` is a real answer rather than a
 * missing one: it means the eye could not be fully measured, which is not the
 * same as the eye being normal. The interface has to keep those apart.
 */

export type Severity = "lower" | "intermediate" | "severe" | "unknown";
export type Phase2Status = "none" | "queued" | "running" | "done" | "failed";
export type PlusGrade = "normal" | "pre-plus" | "plus";
export type IcropStage = 0 | 1 | 2 | 3 | 4 | 5;
export type Zone = "1" | "2" | "3";
export const ZONES: Zone[] = ["1", "2", "3"];
export const PLUS_GRADES: PlusGrade[] = ["normal", "pre-plus", "plus"];

/** Zone and plus as the doctor recorded them, kept apart from the measured ones. */
export interface ExaminerFinding {
  zone?: Zone | null;
  plus?: PlusGrade | null;
}
export type ExaminerFindings = Partial<Record<Eye, ExaminerFinding>>;

export const ICROP_STAGES: IcropStage[] = [0, 1, 2, 3, 4, 5];

/** How each severity should read. `unknown` is deliberately off the traffic
 * light: it is not a milder point on the same scale, it is the absence of an
 * answer, and colouring it green-ish or grey would say the opposite. */
export const SEVERITY_STYLE: Record<
  Severity,
  { label: string; text: string; bg: string; border: string; dot: string }
> = {
  severe: {
    label: "Severe",
    text: "text-rose-700",
    bg: "bg-rose-50",
    border: "border-rose-200",
    dot: "bg-rose-500",
  },
  intermediate: {
    label: "Intermediate",
    text: "text-amber-700",
    bg: "bg-amber-50",
    border: "border-amber-200",
    dot: "bg-amber-500",
  },
  lower: {
    label: "Lower",
    text: "text-emerald-700",
    bg: "bg-emerald-50",
    border: "border-emerald-200",
    dot: "bg-emerald-500",
  },
  unknown: {
    label: "Could not assess",
    text: "text-violet-700",
    bg: "bg-violet-50",
    border: "border-violet-300",
    dot: "bg-violet-500",
  },
};

export const PLUS_STYLE: Record<PlusGrade, { label: string; text: string; bg: string; border: string }> = {
  plus: { label: "Plus", text: "text-rose-700", bg: "bg-rose-50", border: "border-rose-200" },
  "pre-plus": { label: "Pre-plus", text: "text-amber-700", bg: "bg-amber-50", border: "border-amber-200" },
  normal: { label: "Normal", text: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200" },
};

export interface IcropAxis {
  value: string | number | null;
  source: "measured" | "not assessable" | "clinician";
  detail?: string;
  reached?: string | null;
  provisional?: boolean;
}

export interface QuadrantDetail {
  measured: boolean;
  abnormal?: boolean;
  cti?: number;
  diameter_p90?: number;
  reason?: string;
}

export interface PlusBlock {
  grade: PlusGrade | null;
  assessable: boolean;
  reason?: string;
  escalated_by?: string;
  quadrants?: Record<string, QuadrantDetail>;
  quadrant_rule?: {
    grade: PlusGrade | null;
    assessable: boolean;
    reason?: string;
    n_abnormal_quadrants?: number;
    n_quadrants_measured?: number;
  };
  cti?: {
    assessable: boolean;
    value?: number;
    threshold?: number;
    abnormal?: boolean;
    reason?: string;
  };
  thresholds?: { tortuosity_gt?: number; diameter_p90_gt?: number };
}

export interface ZoneBlock {
  assessable: boolean;
  reason?: string;
  vessels_reached_zone?: string;
  vessels_reached_dd?: number;
  most_posterior_zone?: string;
  directions_verified?: number;
  directions_unknown?: number;
}

export interface EvidenceImages {
  map?: string;
  front?: string;
  photos?: { index: number; file: string; image: string; packet: string }[];
}

/* ---------------------------------------------------------------------------
 * The evidence packet — one photograph's measurements, in its own pixels.
 *
 * This is what the viewer draws from. Every polyline is a vessel the pipeline
 * traced, carrying the numbers it was measured with, so the picture and the
 * grade cannot come apart.
 * ------------------------------------------------------------------------ */

export interface EvidenceSegment {
  id: number;
  polyline: [number, number][];
  length_px: number;
  tortuosity?: {
    T?: number;
    T_dimensionless?: number;
    CTI?: number;
    mean_kappa?: number;
    max_kappa?: number;
  };
  caliber?: {
    diameter_px?: number;
    diameter_p90_px?: number;
    source?: "fwhm" | "edt";
    n_cross_sections?: number;
  };
  location?: {
    zone_geom?: string | null;
    quadrant?: string | null;
    dist_to_od_px?: number | null;
  };
  flags?: { spline_ok?: boolean; from_od_root?: boolean };
}

export interface EvidencePacket {
  schema_version: string;
  status: "ok" | "ungradable" | "failed";
  image: { width: number; height: number; eye: string };
  quality?: { score?: number; reasons?: string[] };
  optic_disc?: {
    found: boolean;
    cx?: number | null;
    cy?: number | null;
    dd_px?: number | null;
    confidence?: number;
    reason?: string;
  };
  zones?: {
    available: boolean;
    od_center?: [number, number];
    rings?: { r_3dd?: number; r_5dd?: number; r_zone1?: number; r_zone2?: number };
  };
  quadrants?: {
    orientation?: { eye?: string; temporal_x_sign?: number };
    stats?: Record<string, Record<string, number>>;
  };
  segments: EvidenceSegment[];
  segment_count: number;
}

export interface SeverityEye {
  eye: "L" | "R";
  status: string;
  severity: Severity;
  action: string;
  urgent: boolean;
  assessment_complete: boolean;
  drivers: string[];
  findings: string[];
  degradation_level: string;
  level_meaning: string;
  n_images: number;
  n_aligned: number;
  optic_disc: { found: boolean; n_detections?: number; reason?: string };
  zone: ZoneBlock;
  plus: PlusBlock;
  icrop: { zone: IcropAxis; stage: IcropAxis; plus: IcropAxis };
  per_image: {
    index: number;
    file: string;
    status: string;
    aligned: boolean;
    od_found: boolean;
    n_segments: number;
    quality_reasons?: string[];
  }[];
  evidence: EvidenceImages;
}

export interface SeveritySummary {
  schema_version: string;
  seconds: number;
  provisional: boolean;
  provisional_note: string;
  patient: {
    severity: Severity;
    action: string;
    urgent?: boolean;
    driven_by?: string;
    notes?: string[];
  };
  eyes: SeverityEye[];
  calibration?: Record<string, unknown>;
  evidenceIncomplete?: string[];
}

export interface SeverityState {
  status: Phase2Status;
  jobId: string | null;
  error: string | null;
  analysedAt: string | null;
  severity: Severity | null;
  urgent: boolean;
  icropStages: Partial<Record<Eye, IcropStage>>;
  examinerFindings: ExaminerFindings;
  summary: SeveritySummary | null;
  step: string | null;
  progress: { done: number; total: number } | null;
  seconds: number | null;
}

export function startSeverity(detectionId: string) {
  return apiPost<{ status: Phase2Status; jobId: string }>(
    `/detections/${detectionId}/severity`,
    {},
  );
}

/* ---------------------------------------------------------------------------
 * The preview path
 *
 * The doctor commits a screening once, when they are satisfied with all of it,
 * so severity has to be measurable before there is a record to attach it to.
 * These run against a job rather than a detection; the job id then travels with
 * the create request, and the gateway attaches the assessment it names.
 * ------------------------------------------------------------------------ */

export interface SeverityJobState {
  status: Phase2Status;
  jobId: string;
  step: string | null;
  progress: { done: number; total: number } | null;
  seconds: number | null;
  error: string | null;
  summary: SeveritySummary | null;
}

export function startSeverityPreview(
  eye: "Left" | "Right" | "Both",
  images: { left: File[]; right: File[] },
  meta: { patientId: string; date: string },
) {
  const form = new FormData();
  form.append("eye", eye);
  form.append("patientId", meta.patientId);
  form.append("date", meta.date);
  images.left.forEach((file) => form.append("leftImages", file));
  images.right.forEach((file) => form.append("rightImages", file));
  return apiPost<{ jobId: string; status: Phase2Status }>(
    "/detections/analyze-severity",
    form,
  );
}

export function getSeverityJob(jobId: string) {
  return apiGet<SeverityJobState>(`/detections/severity-jobs/${jobId}`);
}

export function getJobPacket(jobId: string, key: string) {
  return apiGet<EvidencePacket>(
    `/detections/severity-jobs/${jobId}/evidence/${key}`,
  );
}

export function getDetectionPacket(detectionId: string, key: string) {
  return apiGet<EvidencePacket>(
    `/detections/${detectionId}/severity/evidence/${key}`,
  );
}

export function getSeverity(detectionId: string) {
  return apiGet<SeverityState>(`/detections/${detectionId}/severity`);
}

export function getSeverityEvidence(detectionId: string) {
  return apiGet<{ packets: Record<string, unknown> }>(
    `/detections/${detectionId}/severity/evidence`,
  );
}

/**
 * What the examining clinician found in one eye.
 *
 * Any of the three axes, sent only when it changes. The analyser's own zone and
 * plus are untouched by this: both are kept, and the screen shows them side by
 * side rather than letting one stand in for the other.
 */
export function setExaminerRecord(
  detectionId: string,
  record: {
    eye: Eye;
    stage?: IcropStage | null;
    zone?: Zone | null;
    plus?: PlusGrade | null;
  },
) {
  return apiPut<{
    icropStages: Partial<Record<Eye, IcropStage>>;
    examinerFindings: ExaminerFindings;
  }>(`/detections/${detectionId}/examiner`, record);
}

/** "L" / "R" as the rest of the app spells them. */
export function eyeName(side: "L" | "R"): Eye {
  return side === "L" ? "Left" : "Right";
}

/** The eye a doctor should look at first: the worse one, unknown ranked above
 * mild, because an unmeasured eye is not a reassuring eye. */
const RANK: Record<Severity, number> = {
  lower: 0,
  unknown: 1,
  intermediate: 2,
  severe: 3,
};

export function worstEyeFirst(eyes: SeverityEye[]): SeverityEye[] {
  return [...eyes].sort((a, b) => RANK[b.severity] - RANK[a.severity]);
}

/**
 * The analyser's own caveats about what it could not measure.
 *
 * It repeats them on the patient, on each eye and again in the working, in
 * three wordings of the same sentence. The interface says it once instead, in
 * the grade itself: an axis the analyser could not measure reads "not
 * assessable" and a zone it inferred reads "suggested".
 *
 * The caveat is not dropped, only stopped from being said four times.
 */
const BOILERPLATE = [
  /incompletely assessed/i,
  /could not be (fully )?measured/i,
  /stands on its own/i,
  /not the same as finding/i,
];

export function clinicalNotes(notes: string[] | undefined): string[] {
  return (notes ?? []).filter(
    (note) => !BOILERPLATE.some((pattern) => pattern.test(note)),
  );
}

/* The measure line — which eyes to send for analysis — lives in ./threshold,
 * next to the model's own line, so the two can be told apart. */
