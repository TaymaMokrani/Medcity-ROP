import { apiGet, apiPost, apiPut, apiDelete, ApiError } from "./api";


export const REQUIRED_IMAGES_PER_EYE = 5;

export const DOCTOR_DECISIONS = [
  "Pending",
  "Confirms ROP",
  "No ROP",
  "Uncertain",
] as const;
export type DoctorDecision = (typeof DOCTOR_DECISIONS)[number];

/** The two eyes, as the app spells them everywhere. */
export type Eye = "Left" | "Right";

/** Which eyes a screening covers. */
export type EyeSelection = Eye | "Both";

export interface DetectionImage {
  url: string;
  eye: "Left" | "Right";
}

export interface EyeVerdict {
  eye: "Left" | "Right";
  risk: number;
  flagged: boolean;
  /**
   * The line the model drew to decide `flagged`, as it reported it.
   * Missing on screenings recorded before it was kept. See `lib/threshold`.
   */
  threshold?: number;
}

export function riskPercent(risk: number | null | undefined): number {
  return typeof risk === "number" && Number.isFinite(risk)
    ? Math.round(risk * 100)
    : 0;
}

export function formatRisk(risk: number | null | undefined): string {
  return typeof risk === "number" && Number.isFinite(risk)
    ? `${Math.round(risk * 100)}%`
    : "—";
}

export interface EyeAnalysis extends EyeVerdict {
  images: string[];
}

export function worstEye<T extends { risk: number }>(analyses: T[]): T | undefined {
  let worst = analyses[0];
  for (const analysis of analyses) {
    if (analysis.risk > worst.risk) worst = analysis;
  }
  return worst;
}

export interface Detection {
  id: string;
  patientId: string;
  patientName: string;
  date: string;
  risk: number;
  flagged: boolean;
  eye: "Left" | "Right" | "Both";
  image: string;
  images: DetectionImage[];
  eyeResults: EyeAnalysis[];
  notes: string;
  doctorDecision: DoctorDecision;
  decidedAt: string | null;
  createdAt: string;
  /** Where this screening is in the severity pipeline, if it has been sent. */
  phase2Status?: "none" | "queued" | "running" | "done" | "failed";
}

export async function getDetections(): Promise<Detection[]> {
  return apiGet<Detection[]>("/detections");
}

export async function getDetectionsByPatient(
  patientId: string
): Promise<Detection[]> {
  const detections = await apiGet<Detection[]>(
    `/detections?patientId=${encodeURIComponent(patientId)}`
  );
  return [...detections].sort((a, b) => b.date.localeCompare(a.date));
}

export async function getDetectionById(id: string): Promise<Detection | undefined> {
  try {
    return await apiGet<Detection>(`/detections/${id}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return undefined;
    throw e;
  }
}

interface EyeImages {
  left?: File[];
  right?: File[];
}

function imageFormData(images: EyeImages): FormData {
  const formData = new FormData();
  (images.left ?? []).forEach((file) => formData.append("leftImages", file));
  (images.right ?? []).forEach((file) => formData.append("rightImages", file));
  return formData;
}

export async function analyzeDetection(
  eye: Detection["eye"],
  images: EyeImages,
  patient: { patientId: string; date: string }
): Promise<EyeVerdict[]> {
  const formData = imageFormData(images);
  formData.append("eye", eye);
  formData.append("patientId", patient.patientId);
  formData.append("date", patient.date);

  const { eyeResults } = await apiPost<{ eyeResults: EyeVerdict[] }>(
    "/detections/analyze",
    formData
  );
  return eyeResults;
}

export interface NewDetection {
  patientId: string;
  patientName: string;
  date: string;
  eye: Detection["eye"];
  notes: string;
}

export async function addDetection(
  data: NewDetection,
  images: EyeImages = {},
  /** What the doctor approved before saving: the analysis they ran, and
   * anything they recorded themselves. The assessment is fetched server-side
   * from the job this names — it is never posted from here. */
  severity: {
    severityJobId?: string;
    icropStages?: Partial<Record<Eye, number>>;
    examinerFindings?: Partial<Record<Eye, { zone?: string; plus?: string }>>;
  } = {}
): Promise<Detection> {
  const formData = imageFormData(images);
  Object.entries(data).forEach(([key, value]) => formData.append(key, String(value)));
  if (severity.severityJobId) {
    formData.append("severityJobId", severity.severityJobId);
  }
  if (severity.icropStages && Object.keys(severity.icropStages).length) {
    formData.append("icropStages", JSON.stringify(severity.icropStages));
  }
  if (severity.examinerFindings && Object.keys(severity.examinerFindings).length) {
    formData.append(
      "examinerFindings",
      JSON.stringify(severity.examinerFindings),
    );
  }
  return apiPost<Detection>("/detections", formData);
}

export async function updateDetection(
  id: string,
  data: Partial<Detection>,
): Promise<Detection> {
  return apiPut<Detection>(`/detections/${id}`, data);
}

export async function setDoctorDecision(
  id: string,
  doctorDecision: DoctorDecision
): Promise<Detection> {
  return updateDetection(id, { doctorDecision });
}

export async function deleteDetection(id: string): Promise<void> {
  await apiDelete<{ success: boolean }>(`/detections/${id}`);
}


/**
 * The screening as an HL7 FHIR bundle, the format hospital systems file.
 *
 * Built by the gateway, not here: the mapping is part of the contract the
 * server offers, it has tests behind it, and exporting a record is written to
 * the activity log — none of which a browser should be the authority on.
 */
export async function getFhirBundle(id: string): Promise<unknown> {
  return apiGet<unknown>(`/detections/${id}/fhir`);
}
