/**
 * The Workspace's own vocabulary: tools, layers, image settings, measurements.
 * Kept apart from the components so every panel speaks the same words.
 */

export type Tool = "pan" | "ruler" | "angle";

export type Point = [number, number];

/** Where the picture sits on screen: screen = world * k + (tx, ty). */
export interface View {
  k: number;
  tx: number;
  ty: number;
}

export type LayerKey = "vessels" | "disc" | "zones" | "quadrants";

export interface LayerState {
  on: Record<LayerKey, boolean>;
  opacity: Record<LayerKey, number>;
  /** Colour each vessel by how twisted it is. Off: one plain colour. */
  colour: boolean;
  /** Stroke each vessel at the width that was measured on it. */
  caliber: boolean;
}

export const DEFAULT_LAYERS: LayerState = {
  on: { vessels: true, disc: true, zones: true, quadrants: false },
  opacity: { vessels: 1, disc: 1, zones: 0.85, quadrants: 0.8 },
  colour: true,
  caliber: false,
};

export interface ImageAdjust {
  brightness: number;
  contrast: number;
  /** Green channel only, in grey: vessels stand out against the fundus. */
  redFree: boolean;
  invert: boolean;
}

export const DEFAULT_ADJUST: ImageAdjust = {
  brightness: 1,
  contrast: 1,
  redFree: false,
  invert: false,
};

export type Measurement =
  | { id: string; kind: "ruler"; a: Point; b: Point }
  | { id: string; kind: "angle"; a: Point; b: Point; c: Point };

/** A measurement being drawn: the points placed so far, and the cursor. */
export type Draft =
  | { kind: "ruler"; a: Point; b: Point }
  | { kind: "angle"; points: Point[]; cursor: Point };

export type ViewMode = "photo" | "map" | "front";

export type PanelTab = "layers" | "measure" | "summary";

export function distance(a: Point, b: Point): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/** The angle at the vertex b, between the arms to a and c, in degrees. */
export function angleAt(a: Point, b: Point, c: Point): number {
  const v1 = Math.atan2(a[1] - b[1], a[0] - b[0]);
  const v2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
  let degrees = Math.abs(((v2 - v1) * 180) / Math.PI);
  if (degrees > 180) degrees = 360 - degrees;
  return degrees;
}

/** CSS filter for the photograph. The red-free matrix lives in an inline SVG. */
export function imageFilter(adjust: ImageAdjust): string {
  const parts: string[] = [];
  if (adjust.redFree) parts.push("url(#ws-red-free)");
  if (adjust.brightness !== 1) parts.push(`brightness(${adjust.brightness})`);
  if (adjust.contrast !== 1) parts.push(`contrast(${adjust.contrast})`);
  if (adjust.invert) parts.push("invert(1)");
  return parts.join(" ") || "none";
}

/** How the Workspace reaches the rest of the app. */
export interface WorkspaceNav {
  backLabel: string;
  onBack: () => void;
  onOpenPatient: () => void;
  onImportImages: () => void;
  /** A dialog is open over the Workspace, so key presses belong to it. */
  paused: boolean;
}

/** "Distance 2", "Angle 1" — each kind counted on its own. */
export function measurementName(all: Measurement[], index: number): string {
  const m = all[index];
  const n = all.slice(0, index + 1).filter((x) => x.kind === m.kind).length;
  return `${m.kind === "ruler" ? "Distance" : "Angle"} ${n}`;
}

let counter = 0;
export function measurementId(): string {
  counter += 1;
  return `m${Date.now().toString(36)}${counter}`;
}
