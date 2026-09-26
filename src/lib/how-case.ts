/**
 * The real screening this page is built from.
 *
 * Everything shown in "Behind the screening" comes from one eye that this
 * pipeline actually measured — photographs, vessel outlines, the disc, the
 * quadrant numbers and the grade. Nothing is drawn by hand and nothing is
 * invented, because a page that explains how the measuring works is worth
 * very little if the thing it measures is a mock-up.
 *
 * The data was pulled out of the job folder and thinned for the browser: the
 * two hundred longest vessels rather than all six hundred, and every second
 * point of each. See `public/how/case.json`.
 */

export type Point = [x: number, y: number];

export interface QuadrantStat {
  measured: boolean;
  abnormal: boolean;
  cti: number;
  diameter_p90: number;
}

export interface HowCase {
  source: {
    job: string;
    eye: string;
    photograph: string;
    note: string;
    seconds: number | null;
  };
  image: { width: number; height: number };
  quality: {
    score: number;
    focus: number;
    glareFrac: number;
    darkFrac: number;
    ungradable: boolean;
  };
  fov: { cx: number; cy: number; rx: number; ry: number };
  opticDisc: {
    cx: number;
    cy: number;
    ddPx: number;
    confidence: number;
    reason: string;
  };
  rings: { r_3dd: number; r_5dd: number; r_zone1: number; r_zone2: number };
  quadrants: Record<string, QuadrantStat>;
  quadrantNames: Record<string, string>;
  thresholds: { tortuosity_gt: number; diameter_p90_gt: number };
  vessels: Point[][];
  segmentCount: number;
  hero: {
    id: number;
    polyline: Point[];
    lengthPx: number;
    cti: number;
    tDimensionless: number;
    diameterPx: number;
    diameterP90Px: number;
    nCrossSections: number;
    quadrant: string;
  };
  diagnostics: {
    vesselPx: number;
    skelRawPx: number;
    skelFinalPx: number;
    prunedSpurs: number;
    traceTotal: number;
    splineOkRate: number;
  };
  result: {
    severity: string;
    action: string;
    urgent: boolean;
    levelMeaning: string;
    nImages: number;
    nAligned: number;
    drivers: string[];
    findings: string[];
    plus: {
      grade: string;
      nAbnormalQuadrants: number;
      nQuadrantsMeasured: number;
      cti: { value: number; threshold: number; abnormal: boolean };
      primarySignal: string;
    };
    zone: {
      assessable: boolean;
      vessels_reached_zone: string;
      vessels_reached_dd: number;
      most_posterior_zone: string;
      directions_verified: number;
      directions_unknown: number;
    };
    icrop: Record<string, { value: string | null; source: string; detail: string }>;
    provisionalNote: string | null;
  };
}

/** The five photographs, as they came off the camera. */
export const RAW_PHOTOS = [0, 1, 2, 3, 4].map((i) => `/how/raw-${i}.jpg`);

/** The first photograph with the analyser's own drawing on it. */
export const DRAWN_PHOTO = "/how/drawn.jpg";

/** The five photographs aligned into one frame. */
export const MAP_PHOTO = "/how/map.jpg";

/** How far the vessels had grown, in every direction. */
export const FRONT_PHOTO = "/how/front.jpg";

let pending: Promise<HowCase> | null = null;

/** Loaded once per tab. It is a static file, so it never changes under us. */
export function loadCase(): Promise<HowCase> {
  if (!pending) {
    pending = fetch("/how/case.json").then((response) => {
      if (!response.ok) throw new Error("case data unavailable");
      return response.json() as Promise<HowCase>;
    });
    pending.catch(() => {
      pending = null;
    });
  }
  return pending;
}

/** A polyline as an SVG path, in the photograph's own pixel coordinates. */
export function toPath(points: Point[]): string {
  if (!points.length) return "";
  return points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");
}

/** Rough length of a polyline, for ordering and for drawing speed. */
export function pathLength(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  return total;
}

/**
 * Shifts a polyline so its middle sits at the origin, then scales it.
 *
 * Used by the tortuosity chapter to show one real vessel at two sizes without
 * changing its shape by so much as a pixel.
 */
export function rescale(points: Point[], scale: number): Point[] {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  return points.map(([x, y]) => [(x - cx) * scale, (y - cy) * scale]);
}
