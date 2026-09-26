import { apiPost } from "./api";
import { getToken } from "./auth";
import type { Phase2Status, Severity } from "./severity";

/**
 * The Vessel Workspace — Phase 2 measurements, studied on their own.
 *
 * A doctor opens a saved examination or imports photographs, and gets the
 * vessels with every number behind them. Nothing here grades a baby: an import
 * has not been through Phase 1, so it shows measurements and the plus score,
 * never a severity or an action.
 *
 * Everything about how a vessel is coloured and when a number is trusted
 * follows `backend/fastapi-phase2/contracts/EVIDENCE_SCHEMA.md` (2026-09-02).
 */

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

export const WORKSPACE_MAX_PHOTOS = 5;

/* ---------------------------------------------------------------------------
 * The evidence packet, as the Workspace reads it
 * ------------------------------------------------------------------------ */

export type Quadrant = "ST" | "IT" | "SN" | "IN";
export const QUADRANTS: Quadrant[] = ["ST", "IT", "SN", "IN"];
export const QUADRANT_NAMES: Record<Quadrant, string> = {
  ST: "Superior temporal",
  IT: "Inferior temporal",
  SN: "Superior nasal",
  IN: "Inferior nasal",
};

export interface WsSegment {
  id: number;
  polyline: [number, number][];
  length_px: number;
  tortuosity?: {
    CTI?: number | null;
    ICLc?: number | null;
    T_dimensionless?: number | null;
    max_kappa?: number | null;
  };
  caliber?: {
    diameter_px?: number | null;
    diameter_p90_px?: number | null;
    source?: "fwhm" | "edt";
    n_cross_sections?: number;
  };
  location?: {
    zone_geom?: string | null;
    quadrant?: Quadrant | null;
    dist_to_od_px?: number | null;
  };
  flags?: {
    spline_ok?: boolean;
    from_od_root?: boolean;
    is_loop?: boolean;
    cti_reliable?: boolean;
  };
  n_parts?: number;
}

export interface QuadrantStats {
  n_segments: number;
  n_cti_reliable?: number;
  cti_p90?: number;
  cti_max?: number;
  diameter_median?: number;
  diameter_p90?: number;
  total_length_px?: number;
}

export interface WsPacket {
  schema_version: string;
  status: "ok" | "ungradable" | "failed";
  image: { width: number; height: number; eye: "L" | "R" };
  quality?: { ungradable?: boolean; reasons?: string[]; score?: number };
  fov?: { cx: number; cy: number; rx: number; ry: number; is_fallback?: boolean };
  optic_disc?: {
    found: boolean;
    cx?: number | null;
    cy?: number | null;
    dd_px?: number | null;
    confidence?: number | null;
  };
  zones?: {
    available: boolean;
    od_center?: [number, number];
    rings?: { r_3dd?: number; r_5dd?: number; r_zone1?: number; r_zone2?: number };
  };
  quadrants?: {
    orientation?: { temporal_x_sign?: number };
    stats?: Partial<Record<Quadrant, QuadrantStats>>;
  };
  segments: WsSegment[];
  segment_count: number;
}

/* ---------------------------------------------------------------------------
 * The assessment summary, as the Workspace reads it
 * ------------------------------------------------------------------------ */

export interface WsPhoto {
  index: number;
  file: string;
  image: string;
  packet: string;
}

export interface WsPlusIndex {
  assessable: boolean;
  score?: number;
  grade?: "normal" | "pre-plus" | "plus";
  cut_plus?: number;
  cut_preplus?: number;
  reason?: string;
}

export interface WsEye {
  eye: "L" | "R";
  status: string;
  reason?: string;
  severity?: Severity | null;
  action?: string | null;
  findings?: string[];
  degradation_level?: string;
  level_meaning?: string;
  n_images: number;
  n_aligned?: number;
  optic_disc?: { found: boolean };
  zone?: {
    assessable: boolean;
    reason?: string;
    most_posterior_zone?: string;
    vessels_reached_zone?: string;
    suggested?: {
      zone?: string;
      caveat?: string;
      confidence?: string;
      n_directions_verified?: number;
      n_directions_with_a_front?: number;
    };
  };
  plus?: {
    grade: "normal" | "pre-plus" | "plus" | null;
    assessable: boolean;
    reason?: string;
    escalated_by?: string;
    quadrants?: Partial<
      Record<
        Quadrant,
        { measured: boolean; abnormal?: boolean; cti?: number; diameter_p90?: number }
      >
    >;
    thresholds?: { tortuosity_gt?: number; diameter_p90_gt?: number };
    quadrant_rule?: { n_abnormal_quadrants?: number; n_quadrants_measured?: number };
    index?: WsPlusIndex;
  };
  per_image?: { index: number; status: string; quality_reasons?: string[]; od_found?: boolean }[];
  evidence: { map?: string; front?: string; photos?: WsPhoto[] };
}

export interface WsSummary {
  provisional?: boolean;
  provisional_note?: string;
  patient?: { severity?: Severity; action?: string; urgent?: boolean };
  eyes: WsEye[];
}

/* ---------------------------------------------------------------------------
 * A session: what is open in the Workspace
 * ------------------------------------------------------------------------ */

export type WsSource =
  | { kind: "detection"; detectionId: string }
  | { kind: "import"; jobId: string };

/**
 * What the examination itself says, for the printed report.
 *
 * The Workspace measures vessels; it does not hold opinions. But the page it
 * prints is filed in a patient's notes, and a filed page that leaves out the
 * stage the examiner entered and the conclusion they reached is not a record of
 * the examination — it is a record of the machine's half of it.
 */
export interface WsRecord {
  patientId: string;
  dateOfBirth?: string;
  gestationalAge?: number;
  examinedOn: string;
  doctorDecision?: string;
  decidedAt?: string | null;
  stages?: Partial<Record<"Left" | "Right", number>>;
  findings?: Partial<
    Record<"Left" | "Right", { zone?: string | null; plus?: string | null }>
  >;
}

export interface WsSession {
  source: WsSource;
  /** Patient name, or a plain description of an anonymous import. */
  title: string;
  subtitle: string;
  /** Whether Phase 1 screened these eyes. Imports never were. */
  screened: boolean;
  summary: WsSummary;
  /** Present for a saved examination, absent for an anonymous import. */
  record?: WsRecord;
}

export interface WsJobState {
  status: Phase2Status;
  jobId: string | null;
  step: string | null;
  progress: { done: number; total: number } | null;
  seconds: number | null;
  error: string | null;
  summary: WsSummary | null;
}

/** Starts a measurement on imported photographs. Nothing is saved. */
export function startWorkspaceAnalysis(images: { left: File[]; right: File[] }) {
  const form = new FormData();
  images.left.forEach((file) => form.append("leftImages", file));
  images.right.forEach((file) => form.append("rightImages", file));
  return apiPost<{ jobId: string; status: Phase2Status }>("/workspace/analyze", form);
}

/**
 * An evidence image as a local blob, so a canvas that draws it may be exported.
 * `/files/severity/:name` serves the same file, but for an `<img>` to show.
 * A canvas that has drawn it can only be exported when the response carried
 * CORS headers, which this route does and that one does not.
 */
export async function evidenceImageBlob(url: string): Promise<Blob> {
  const name = url.split("/").pop() ?? "";
  const token = getToken();
  const response = await fetch(
    `${BASE_URL}/workspace/evidence-image/${encodeURIComponent(name)}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  );
  if (!response.ok) throw new Error(`Could not load ${name} (${response.status})`);
  return response.blob();
}

/* ---------------------------------------------------------------------------
 * How twisted a vessel is — the colour rule from the evidence contract
 *
 * Colour by the HOTTER of CTI and ICLc, never by one alone. CTI (arc over chord)
 * fails when a vessel was traced in pieces: each piece looks straight. ICLc
 * (curvature per unit length) fails the other way: a long gentle snake reads
 * low. Taking the hotter of the two survives both. The ramps are anchored on the
 * measured population; the red band starts at CTI 1.105 or ICLc 0.0515.
 * ------------------------------------------------------------------------ */

/** Where on the heat scale the red band starts. */
export const RED_BAND = 0.8;

const CTI_RAMP: [number, number][] = [
  [1.0, 0],
  [1.044, 0.35],
  [1.105, RED_BAND],
  [1.39, 1],
];

const ICLC_RAMP: [number, number][] = [
  [0.005, 0],
  [0.018, 0.35],
  [0.0515, RED_BAND],
  [0.1, 1],
];

/** A vessel whose CTI is unreliable AND this high is an arithmetic artefact. */
const ARTEFACT_CTI = 1.15;

/** The contract's display filter: below this a trace is genuinely tiny. */
export const DEFAULT_MIN_LENGTH_PX = 15;

function ramp(value: number, stops: [number, number][]): number {
  if (value <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [x1, y1] = stops[i];
    const [x0, y0] = stops[i - 1];
    if (value <= x1) return y0 + ((value - x0) / (x1 - x0)) * (y1 - y0);
  }
  return stops[stops.length - 1][1];
}

/**
 * Whether arc-over-chord means anything on this vessel.
 *
 * Old packets carry no flag; the contract's fallback is a length of 30 px,
 * which catches most problems but not a long closed loop.
 */
export function ctiReliable(segment: WsSegment): boolean {
  const flag = segment.flags?.cti_reliable;
  if (typeof flag === "boolean") return flag;
  return (segment.length_px ?? 0) >= 30;
}

/** The suspected artefact: unreliable, and alarming only because of arithmetic. */
export function ctiArtefact(segment: WsSegment): boolean {
  return !ctiReliable(segment) && (segment.tortuosity?.CTI ?? 1) >= ARTEFACT_CTI;
}

/** 0 (straight) to 1 (very twisted), or null when the vessel should be drawn plain. */
export function vesselHeat(segment: WsSegment): number | null {
  if (ctiArtefact(segment)) return null;
  const cti = segment.tortuosity?.CTI ?? 1;
  const iclc = segment.tortuosity?.ICLc ?? 0;
  return Math.max(ramp(cti, CTI_RAMP), ramp(iclc, ICLC_RAMP));
}

const HEAT_STOPS: [number, [number, number, number]][] = [
  [0, [56, 189, 248]], // sky — straight
  [0.35, [45, 212, 191]], // teal — typical
  [0.6, [250, 204, 21]], // amber
  [RED_BAND, [249, 115, 22]], // orange — the red band begins
  [1, [244, 63, 94]], // rose
];

export function heatColour(heat: number, alpha = 1): string {
  const h = Math.min(1, Math.max(0, heat));
  let i = 1;
  while (i < HEAT_STOPS.length - 1 && h > HEAT_STOPS[i][0]) i++;
  const [p0, c0] = HEAT_STOPS[i - 1];
  const [p1, c1] = HEAT_STOPS[i];
  const t = p1 === p0 ? 0 : (h - p0) / (p1 - p0);
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
  return `rgba(${mix(c0[0], c1[0])}, ${mix(c0[1], c1[1])}, ${mix(c0[2], c1[2])}, ${alpha})`;
}

export const PLAIN_VESSEL = "rgba(203, 213, 225, 0.75)";

/* ---------------------------------------------------------------------------
 * Filters
 * ------------------------------------------------------------------------ */

export interface WsFilters {
  minLength: number;
  /** Show only vessels at least this hot on the heat scale (0–1). */
  minHeat: number;
  quadrant: Quadrant | null;
}

export const DEFAULT_FILTERS: WsFilters = {
  minLength: DEFAULT_MIN_LENGTH_PX,
  minHeat: 0,
  quadrant: null,
};

export function passesFilters(segment: WsSegment, filters: WsFilters): boolean {
  if ((segment.length_px ?? 0) < filters.minLength) return false;
  if (filters.quadrant && segment.location?.quadrant !== filters.quadrant) return false;
  if (filters.minHeat > 0) {
    const heat = vesselHeat(segment);
    if (heat === null || heat < filters.minHeat) return false;
  }
  return (segment.polyline?.length ?? 0) >= 2;
}

/* ---------------------------------------------------------------------------
 * Units — pixels, and disc diameters
 *
 * A disc diameter (DD) is the clinical unit: zones and the plus region are
 * defined in it. Each photograph measures its own disc when it can see one. A
 * photograph without a disc borrows it from another photograph of the same
 * eye — same camera, same magnification — and says so.
 * ------------------------------------------------------------------------ */

export interface DiscScale {
  ddPx: number;
  /** null when this photograph found its own disc, else the photo it came from. */
  borrowedFrom: number | null;
}

const MIN_DISC_CONFIDENCE = 0.5;

export function ownDisc(packet: WsPacket | null | undefined): number | null {
  const disc = packet?.optic_disc;
  if (!disc?.found || !disc.dd_px) return null;
  if ((disc.confidence ?? 1) < MIN_DISC_CONFIDENCE) return null;
  return disc.dd_px;
}

export function discScale(
  current: WsPacket | null,
  others: { index: number; packet: WsPacket | null }[],
): DiscScale | null {
  const own = ownDisc(current);
  if (own) return { ddPx: own, borrowedFrom: null };
  for (const other of others) {
    const dd = ownDisc(other.packet);
    if (dd) return { ddPx: dd, borrowedFrom: other.index };
  }
  return null;
}

export function fmt(value: number | null | undefined, digits = 2): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—";
}

export function pxAndDd(px: number, scale: DiscScale | null, pxDigits = 0): string {
  const base = `${px.toFixed(pxDigits)} px`;
  if (!scale) return base;
  return `${base} · ${(px / scale.ddPx).toFixed(2)} DD`;
}

export function eyeLabel(eye: "L" | "R"): string {
  return eye === "L" ? "Left" : "Right";
}

/** How many photographs of this eye were actually measured. */
export function photoCount(eye: WsEye): number {
  return eye.evidence.photos?.length ?? eye.n_images ?? 0;
}
