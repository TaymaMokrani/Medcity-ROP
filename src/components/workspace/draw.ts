/**
 * Drawing the measurements over a photograph.
 *
 * Every mark is a measurement, not an illustration: each line is a vessel the
 * pipeline traced, in the pixels it was measured in. Coordinates in a packet are
 * original-photograph pixels ("world"); the view maps them to the screen with
 * one uniform scale, never x and y separately.
 *
 * Lines are drawn in screen space at every zoom, so they stay sharp however far
 * the doctor zooms in, instead of being a stretched bitmap.
 */

import {
  heatColour,
  passesFilters,
  pxAndDd,
  vesselHeat,
  type DiscScale,
  type Quadrant,
  type WsFilters,
  type WsPacket,
  type WsSegment,
} from "@/lib/workspace";
import {
  angleAt,
  distance,
  type Draft,
  type LayerState,
  type Measurement,
  type Point,
  type View,
} from "./state";

const PLAIN = "rgba(125, 211, 252, 0.9)";
const PLAIN_ARTEFACT = "rgba(148, 163, 184, 0.7)";
const DISC = "rgba(234, 242, 251, 0.95)";
const ZONE_I = "rgba(167, 139, 250, 0.95)";
const ZONE_II = "rgba(148, 163, 184, 0.9)";
const QUADRANT_LINE = "rgba(226, 232, 240, 0.4)";
const QUADRANT_TEXT = "rgba(226, 232, 240, 0.75)";
const QUADRANT_ABNORMAL = "rgba(251, 113, 133, 1)";
const MEASURE = "#38bdf8";
const LABEL_BG = "rgba(5, 7, 12, 0.86)";
const LABEL_TEXT = "#eaf2fb";
const FONT = "'Geist Variable', ui-sans-serif, system-ui, sans-serif";

export interface OverlayInput {
  packet: WsPacket;
  view: View;
  dpr: number;
  width: number;
  height: number;
  layers: LayerState;
  filters: WsFilters;
  hoveredId: number | null;
  selectedId: number | null;
  abnormalQuadrants: Quadrant[];
  measurements: Measurement[];
  draft: Draft | null;
  scale: DiscScale | null;
  hidden: boolean;
}

/** How thick a centreline is on screen: thin when zoomed out, never hairline. */
function centrelineWidth(k: number): number {
  return Math.min(3.4, Math.max(1.2, 2.6 * k));
}

export function drawOverlay(ctx: CanvasRenderingContext2D, input: OverlayInput): void {
  const { view, dpr, width, height } = input;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width * dpr, height * dpr);

  const world = () =>
    ctx.setTransform(dpr * view.k, 0, 0, dpr * view.k, dpr * view.tx, dpr * view.ty);
  const screen = () => ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (!input.hidden && input.packet.status === "ok") {
    world();
    drawMeasured(ctx, input);
    screen();
    drawRingLabels(ctx, input);
  }

  // The doctor's own measurements stay visible even with the overlays hidden:
  // they are what the doctor is checking the photograph against.
  world();
  drawMeasurementLines(ctx, input);
  screen();
  drawMeasurementLabels(ctx, input);
}

function drawMeasured(ctx: CanvasRenderingContext2D, input: OverlayInput): void {
  const { packet, layers, view } = input;
  const disc = packet.optic_disc;
  const hasDisc = Boolean(disc?.found && disc.cx != null && disc.cy != null);
  const fov = packet.fov && !packet.fov.is_fallback ? packet.fov : null;

  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Rings and axes are clipped to the retina so they never run across the black
  // corners of the frame.
  if (hasDisc && (layers.on.zones || layers.on.quadrants)) {
    ctx.save();
    if (fov) {
      ctx.beginPath();
      ctx.ellipse(fov.cx, fov.cy, fov.rx, fov.ry, 0, 0, Math.PI * 2);
      ctx.clip();
    }
    if (layers.on.quadrants) drawQuadrants(ctx, input);
    if (layers.on.zones && packet.zones?.available) drawZones(ctx, input);
    ctx.restore();
  }

  if (layers.on.vessels) {
    ctx.globalAlpha = layers.opacity.vessels;
    for (const segment of packet.segments ?? []) {
      if (!passesFilters(segment, input.filters)) continue;
      if (segment.id === input.hoveredId || segment.id === input.selectedId) continue;
      strokeVessel(ctx, segment, layers, view.k);
    }
    ctx.globalAlpha = 1;
  }

  // The vessel under the cursor and the pinned one are drawn last, on top.
  for (const id of [input.selectedId, input.hoveredId]) {
    if (id == null) continue;
    const segment = packet.segments?.find((s) => s.id === id);
    if (segment) emphasise(ctx, segment, layers, view.k, id === input.selectedId);
  }

  if (layers.on.disc && hasDisc) drawDisc(ctx, input);
}

function vesselColour(segment: WsSegment, layers: LayerState): string {
  if (!layers.colour) return PLAIN;
  const heat = vesselHeat(segment);
  return heat === null ? PLAIN_ARTEFACT : heatColour(heat, 0.95);
}

function tracePath(ctx: CanvasRenderingContext2D, segment: WsSegment): void {
  const points = segment.polyline;
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
}

function vesselWidth(segment: WsSegment, layers: LayerState, k: number): number {
  if (layers.caliber) return Math.max(1 / k, segment.caliber?.diameter_px ?? 2);
  return centrelineWidth(k) / k;
}

function strokeVessel(
  ctx: CanvasRenderingContext2D,
  segment: WsSegment,
  layers: LayerState,
  k: number,
): void {
  if ((segment.polyline?.length ?? 0) < 2) return;
  tracePath(ctx, segment);
  ctx.strokeStyle = vesselColour(segment, layers);
  ctx.lineWidth = vesselWidth(segment, layers, k);

  // A width measured by distance transform rather than cross-sections is
  // weaker evidence, and says so by being fainter.
  const base = layers.opacity.vessels;
  ctx.globalAlpha = segment.caliber?.source === "edt" ? base * 0.55 : base;
  ctx.stroke();
  ctx.globalAlpha = base;
}

function emphasise(
  ctx: CanvasRenderingContext2D,
  segment: WsSegment,
  layers: LayerState,
  k: number,
  pinned: boolean,
): void {
  if ((segment.polyline?.length ?? 0) < 2) return;
  const width = vesselWidth(segment, layers, k);

  // a dark halo lifts the vessel off whatever is underneath it
  tracePath(ctx, segment);
  ctx.strokeStyle = "rgba(5, 7, 12, 0.85)";
  ctx.lineWidth = width + 5 / k;
  ctx.stroke();

  tracePath(ctx, segment);
  ctx.strokeStyle = pinned ? "#ffffff" : vesselColour(segment, layers);
  ctx.lineWidth = width + (pinned ? 1.5 : 1) / k;
  ctx.stroke();

  if (pinned) {
    const points = segment.polyline;
    for (const [x, y] of [points[0], points[points.length - 1]]) {
      ctx.beginPath();
      ctx.arc(x, y, 3.5 / k, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
    }
  }
}

function drawDisc(ctx: CanvasRenderingContext2D, input: OverlayInput): void {
  const disc = input.packet.optic_disc!;
  const k = input.view.k;
  const cx = disc.cx!;
  const cy = disc.cy!;
  const radius = (disc.dd_px ?? 40) / 2;

  ctx.save();
  ctx.globalAlpha = input.layers.opacity.disc;
  ctx.strokeStyle = DISC;
  ctx.lineWidth = 1.6 / k;
  // an uncertain disc is drawn dashed rather than silently trusted
  if ((disc.confidence ?? 1) < 0.5) ctx.setLineDash([6 / k, 5 / k]);
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.setLineDash([]);
  const arm = Math.min(radius * 0.45, 14 / k);
  ctx.beginPath();
  ctx.moveTo(cx - arm, cy);
  ctx.lineTo(cx + arm, cy);
  ctx.moveTo(cx, cy - arm);
  ctx.lineTo(cx, cy + arm);
  ctx.stroke();
  ctx.restore();
}

function drawZones(ctx: CanvasRenderingContext2D, input: OverlayInput): void {
  const zones = input.packet.zones!;
  const centre = zones.od_center;
  if (!centre) return;
  const k = input.view.k;

  ctx.save();
  ctx.globalAlpha = input.layers.opacity.zones;
  ctx.lineWidth = 1.4 / k;
  ctx.setLineDash([10 / k, 7 / k]);
  for (const [radius, colour] of [
    [zones.rings?.r_zone1, ZONE_I],
    [zones.rings?.r_zone2, ZONE_II],
  ] as [number | undefined, string][]) {
    if (!radius) continue;
    ctx.strokeStyle = colour;
    ctx.beginPath();
    ctx.arc(centre[0], centre[1], radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/** The ring names sit where each ring crosses the top of the retina. */
function drawRingLabels(ctx: CanvasRenderingContext2D, input: OverlayInput): void {
  const { packet, layers, view } = input;
  if (!layers.on.zones || !packet.zones?.available || !packet.optic_disc?.found) return;
  const centre = packet.zones.od_center;
  if (!centre) return;

  const top = packet.fov && !packet.fov.is_fallback ? packet.fov.cy - packet.fov.ry : 0;
  for (const [radius, name, colour] of [
    [packet.zones.rings?.r_zone1, "Zone I · approx.", ZONE_I],
    [packet.zones.rings?.r_zone2, "Zone II · approx.", ZONE_II],
  ] as [number | undefined, string, string][]) {
    if (!radius) continue;
    const y = centre[1] - radius;
    if (y < top) continue; // the ring leaves the photograph before its top
    const sx = centre[0] * view.k + view.tx;
    const sy = y * view.k + view.ty;
    ctx.globalAlpha = layers.opacity.zones;
    label(ctx, name, sx, sy - 10, colour);
    ctx.globalAlpha = 1;
  }
}

function drawQuadrants(ctx: CanvasRenderingContext2D, input: OverlayInput): void {
  const { packet, view } = input;
  const disc = packet.optic_disc!;
  const cx = disc.cx!;
  const cy = disc.cy!;
  const k = view.k;
  const reach = Math.max(packet.image.width, packet.image.height) * 1.5;

  ctx.save();
  ctx.globalAlpha = input.layers.opacity.quadrants;
  ctx.strokeStyle = QUADRANT_LINE;
  ctx.lineWidth = 1 / k;
  ctx.setLineDash([4 / k, 6 / k]);
  ctx.beginPath();
  ctx.moveTo(cx - reach, cy);
  ctx.lineTo(cx + reach, cy);
  ctx.moveTo(cx, cy - reach);
  ctx.lineTo(cx, cy + reach);
  ctx.stroke();
  ctx.setLineDash([]);

  // Which side is temporal depends on the eye, and the packet has resolved it:
  // +1 means temporal lies towards increasing x. Superior is decreasing y.
  const sign = packet.quadrants?.orientation?.temporal_x_sign ?? 1;
  const offset = 150;
  const places: [Quadrant, number, number][] = [
    ["ST", sign * offset, -offset],
    ["IT", sign * offset, offset],
    ["SN", -sign * offset, -offset],
    ["IN", -sign * offset, offset],
  ];
  ctx.font = `500 ${13 / k}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const [name, dx, dy] of places) {
    ctx.fillStyle = input.abnormalQuadrants.includes(name) ? QUADRANT_ABNORMAL : QUADRANT_TEXT;
    ctx.fillText(name, cx + dx, cy + dy);
  }
  ctx.restore();
}

/* ---------------------------------------------------------------------------
 * The doctor's measurements
 * ------------------------------------------------------------------------ */

function drawMeasurementLines(ctx: CanvasRenderingContext2D, input: OverlayInput): void {
  const k = input.view.k;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const line = (points: Point[], dashed: boolean) => {
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (const p of points.slice(1)) ctx.lineTo(p[0], p[1]);
    ctx.setLineDash(dashed ? [5 / k, 4 / k] : []);
    ctx.strokeStyle = "rgba(5, 7, 12, 0.7)";
    ctx.lineWidth = 3.5 / k;
    ctx.stroke();
    ctx.strokeStyle = MEASURE;
    ctx.lineWidth = 1.5 / k;
    ctx.stroke();
    ctx.setLineDash([]);
  };
  const dot = (p: Point) => {
    ctx.beginPath();
    ctx.arc(p[0], p[1], 3.5 / k, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.lineWidth = 1.5 / k;
    ctx.strokeStyle = MEASURE;
    ctx.stroke();
  };
  const arc = (a: Point, b: Point, c: Point) => {
    const r = Math.min(26 / k, distance(a, b) * 0.4, distance(c, b) * 0.4);
    const start = Math.atan2(a[1] - b[1], a[0] - b[0]);
    const end = Math.atan2(c[1] - b[1], c[0] - b[0]);
    let sweep = end - start;
    while (sweep > Math.PI) sweep -= Math.PI * 2;
    while (sweep < -Math.PI) sweep += Math.PI * 2;
    ctx.beginPath();
    ctx.arc(b[0], b[1], r, start, start + sweep, sweep < 0);
    ctx.strokeStyle = MEASURE;
    ctx.lineWidth = 1.2 / k;
    ctx.stroke();
  };

  for (const m of input.measurements) {
    if (m.kind === "ruler") {
      line([m.a, m.b], false);
      dot(m.a);
      dot(m.b);
    } else {
      line([m.a, m.b, m.c], false);
      arc(m.a, m.b, m.c);
      [m.a, m.b, m.c].forEach(dot);
    }
  }

  const draft = input.draft;
  if (draft?.kind === "ruler") {
    line([draft.a, draft.b], true);
    dot(draft.a);
  } else if (draft?.kind === "angle" && draft.points.length) {
    const pts = [...draft.points, draft.cursor];
    line(pts, true);
    if (pts.length === 3) arc(pts[0], pts[1], pts[2]);
    draft.points.forEach(dot);
  }
}

function drawMeasurementLabels(ctx: CanvasRenderingContext2D, input: OverlayInput): void {
  const { view, scale } = input;
  const toScreen = (p: Point): Point => [p[0] * view.k + view.tx, p[1] * view.k + view.ty];

  const rulerText = (a: Point, b: Point) => pxAndDd(distance(a, b), scale);

  for (const m of input.measurements) {
    if (m.kind === "ruler") {
      const [sx, sy] = toScreen([(m.a[0] + m.b[0]) / 2, (m.a[1] + m.b[1]) / 2]);
      label(ctx, rulerText(m.a, m.b), sx, sy - 14, LABEL_TEXT);
    } else {
      const [sx, sy] = toScreen(m.b);
      label(ctx, `${angleAt(m.a, m.b, m.c).toFixed(1)}°`, sx, sy - 18, LABEL_TEXT);
    }
  }

  const draft = input.draft;
  if (draft?.kind === "ruler") {
    const [sx, sy] = toScreen(draft.b);
    label(ctx, rulerText(draft.a, draft.b), sx + 14, sy - 14, LABEL_TEXT, "left");
  } else if (draft?.kind === "angle" && draft.points.length === 2) {
    const [sx, sy] = toScreen(draft.points[1]);
    const degrees = angleAt(draft.points[0], draft.points[1], draft.cursor);
    label(ctx, `${degrees.toFixed(1)}°`, sx, sy - 18, LABEL_TEXT);
  }
}

/** A small dark pill with text, drawn in screen pixels. */
function label(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  colour: string,
  align: "center" | "left" = "center",
): void {
  ctx.save();
  ctx.font = `500 11px ${FONT}`;
  ctx.textBaseline = "middle";
  const width = ctx.measureText(text).width + 14;
  const height = 20;
  const left = align === "center" ? x - width / 2 : x;
  ctx.fillStyle = LABEL_BG;
  ctx.beginPath();
  ctx.roundRect(left, y - height / 2, width, height, 6);
  ctx.fill();
  ctx.strokeStyle = "rgba(180, 210, 245, 0.18)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = colour;
  ctx.textAlign = "left";
  ctx.fillText(text, left + 7, y + 0.5);
  ctx.restore();
}

/* ---------------------------------------------------------------------------
 * Finding the vessel under the cursor
 * ------------------------------------------------------------------------ */

const boxes = new WeakMap<WsSegment, [number, number, number, number]>();

function box(segment: WsSegment): [number, number, number, number] {
  let cached = boxes.get(segment);
  if (!cached) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [x, y] of segment.polyline ?? []) {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
    cached = [x0, y0, x1, y1];
    boxes.set(segment, cached);
  }
  return cached;
}

/** The visible vessel nearest a point, within `tolerance` world pixels. */
export function vesselAt(
  packet: WsPacket,
  filters: WsFilters,
  x: number,
  y: number,
  tolerance: number,
): WsSegment | null {
  let best: WsSegment | null = null;
  let bestDistance = tolerance;

  for (const segment of packet.segments ?? []) {
    if (!passesFilters(segment, filters)) continue;
    const [x0, y0, x1, y1] = box(segment);
    if (x < x0 - bestDistance || x > x1 + bestDistance) continue;
    if (y < y0 - bestDistance || y > y1 + bestDistance) continue;

    const points = segment.polyline;
    for (let i = 1; i < points.length; i++) {
      const d = distanceToLine(x, y, points[i - 1], points[i]);
      if (d < bestDistance) {
        bestDistance = d;
        best = segment;
      }
    }
  }
  return best;
}

function distanceToLine(px: number, py: number, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(px - a[0], py - a[1]);
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / lengthSquared));
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}

export function segmentBox(segment: WsSegment): [number, number, number, number] {
  return box(segment);
}
