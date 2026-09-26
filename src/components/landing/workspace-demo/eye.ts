/**
 * The demo eye shown on the landing page.
 *
 * `public/demo/demo-eye.json` is the Phase 2 output for `public/demo-image.jpg`,
 * cleaned for display: broken pieces joined, lines smoothed, crumbs dropped, and
 * each branch linked to the vessel it grows from. Vessels are coloured with the Workspace's
 * own rule (`vesselHeat`), so what a visitor sees is what a doctor sees in the app.
 */

import { useEffect, useState } from "react";
import {
    heatColour,
    vesselHeat,
    type Quadrant,
    type WsSegment,
} from "@/lib/workspace";

export interface DemoEye {
    image: { width: number; height: number; eye: "L" | "R" };
    fov: { cx: number; cy: number; rx: number; ry: number };
    optic_disc: { found: true; cx: number; cy: number; dd_px: number; confidence: number };
    zones: { od_center: [number, number]; rings: { r_zone1?: number; r_zone2?: number } };
    quadrants: { orientation: { temporal_x_sign: number } };
    abnormal_quadrants: Quadrant[];
    segment_count: number;
    segments: DemoSegment[];
}

/** A vessel, plus the vessel it branches from and how far along that one it starts. */
export type DemoSegment = WsSegment & { parent?: number | null; at?: number | null };

export type Rgb = [number, number, number];

export interface Vessel {
    segment: DemoSegment;
    /** Running length along the polyline, so part of a vessel can be drawn. */
    cum: number[];
    total: number;
    /** 0 at the optic disc, 1 at the vessel that starts furthest from it. */
    start: number;
    heat: number | null;
    rgb: Rgb;
    /** When it starts growing and how long it takes, as fractions of the growth window. */
    begin: number;
    grow: number;
}

export interface PreparedEye {
    eye: DemoEye;
    vessels: Vessel[];
    longest: number;
}

export interface View {
    k: number;
    tx: number;
    ty: number;
}

export const PLAIN_RGB: Rgb = [125, 211, 252];
const ARTEFACT_RGB: Rgb = [148, 163, 184];
const FONT = "'Geist Variable', ui-sans-serif, system-ui, sans-serif";

function parseRgb(colour: string): Rgb {
    const [r, g, b] = colour.match(/\d+/g)!.map(Number);
    return [r, g, b];
}

export function mix(a: Rgb, b: Rgb, t: number, alpha = 1): string {
    const m = (i: number) => Math.round(a[i] + (b[i] - a[i]) * t);
    return `rgba(${m(0)}, ${m(1)}, ${m(2)}, ${alpha})`;
}

function prepare(eye: DemoEye): PreparedEye {
    const { cx, cy } = eye.optic_disc;
    let furthest = 1;
    let longest = 1;
    const vessels = eye.segments.map((segment) => {
        const points = segment.polyline;
        const cum = [0];
        for (let i = 1; i < points.length; i++) {
            const [x0, y0] = points[i - 1];
            const [x1, y1] = points[i];
            cum.push(cum[i - 1] + Math.hypot(x1 - x0, y1 - y0));
        }
        const total = cum[cum.length - 1];
        const start = Math.hypot(points[0][0] - cx, points[0][1] - cy);
        furthest = Math.max(furthest, start);
        longest = Math.max(longest, total);
        const heat = vesselHeat(segment);
        const rgb = heat === null ? ARTEFACT_RGB : parseRgb(heatColour(heat));
        return { segment, cum, total, start, heat, rgb, begin: 0, grow: 0 };
    });

    // Growth runs at one speed along the tree: a branch starts when its parent's
    // tip passes the junction. A vessel with no parent starts as if it had grown
    // straight out from the disc.
    const beginPx = new Map<Vessel, number>();
    const beginOf = (v: Vessel, depth = 0): number => {
        const known = beginPx.get(v);
        if (known !== undefined) return known;
        const parent = v.segment.parent != null ? vessels[v.segment.parent] : undefined;
        const px = parent && depth < 50 ? beginOf(parent, depth + 1) + (v.segment.at ?? 0) : v.start * 0.55;
        beginPx.set(v, px);
        return px;
    };
    let end = 1;
    for (const v of vessels) end = Math.max(end, beginOf(v) + v.total);
    for (const v of vessels) {
        v.begin = beginOf(v) / end;
        v.grow = v.total / end;
        v.start /= furthest;
    }
    return { eye, vessels, longest };
}

let cache: Promise<PreparedEye> | null = null;

export function useDemoEye(): PreparedEye | null {
    const [eye, setEye] = useState<PreparedEye | null>(null);
    useEffect(() => {
        cache ??= fetch("/demo/demo-eye.json")
            .then((r) => r.json() as Promise<DemoEye>)
            .then(prepare);
        let live = true;
        cache.then((e) => live && setEye(e)).catch(() => (cache = null));
        return () => {
            live = false;
        };
    }, []);
    return eye;
}

/** The retina's bounding box, which is what gets fitted into the frame. */
export function frameOf(eye: DemoEye) {
    const { cx, cy, rx, ry } = eye.fov;
    return { x: cx - rx, y: cy - ry, w: rx * 2, h: ry * 2 };
}

export function fitView(eye: DemoEye, width: number, height: number): View {
    const f = frameOf(eye);
    const k = Math.min(width / f.w, height / f.h);
    return {
        k,
        tx: (width - f.w * k) / 2 - f.x * k,
        ty: (height - f.h * k) / 2 - f.y * k,
    };
}

export function toWorld(view: View, sx: number, sy: number): [number, number] {
    return [(sx - view.tx) / view.k, (sy - view.ty) / view.k];
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const clamp = clamp01;
export const ease = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);

/* ---------------------------------------------------------------------------
 * Drawing — every helper expects the world transform to be set
 * ------------------------------------------------------------------------ */

/**
 * The retina is the camera's circle, cut by the edges of the photo. (The packet's
 * field of view is an ellipse fitted inside the photo, which is a little smaller.)
 */
export function clipToRetina(ctx: CanvasRenderingContext2D, eye: DemoEye): void {
    const { cx, cy, rx, ry } = eye.fov;
    ctx.beginPath();
    ctx.rect(0, 0, eye.image.width, eye.image.height);
    ctx.clip();
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(rx, ry), 0, Math.PI * 2);
    ctx.clip();
}

/** Strokes the first `frac` of a vessel, from its end nearest the disc. */
export function traceVessel(ctx: CanvasRenderingContext2D, v: Vessel, frac = 1): [number, number] {
    const points = v.segment.polyline;
    const upto = v.total * clamp01(frac);
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    let tip: [number, number] = [points[0][0], points[0][1]];
    for (let i = 1; i < points.length; i++) {
        if (v.cum[i] <= upto) {
            ctx.lineTo(points[i][0], points[i][1]);
            tip = [points[i][0], points[i][1]];
            continue;
        }
        const [x0, y0] = points[i - 1];
        const [x1, y1] = points[i];
        const t = (upto - v.cum[i - 1]) / (v.cum[i] - v.cum[i - 1] || 1);
        tip = [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
        ctx.lineTo(tip[0], tip[1]);
        break;
    }
    return tip;
}

/**
 * Each overlay takes a `glow` from 0 to 1. While a layer is being placed it
 * glows, so the eye goes to it; once placed it settles back to its plain look.
 */

function glowOn(ctx: CanvasRenderingContext2D, colour: string, glow: number): void {
    ctx.shadowColor = colour;
    ctx.shadowBlur = 18 * glow;
}

export function drawDisc(
    ctx: CanvasRenderingContext2D,
    eye: DemoEye,
    k: number,
    sweep: number,
    alpha: number,
    glow = 0,
): void {
    if (sweep <= 0 || alpha <= 0) return;
    const { cx, cy, dd_px } = eye.optic_disc;
    const r = dd_px / 2;
    ctx.save();
    ctx.globalAlpha = alpha;

    if (glow > 0) {
        const halo = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, r * 3.2);
        halo.addColorStop(0, `rgba(125, 211, 252, ${0.34 * glow})`);
        halo.addColorStop(1, "rgba(125, 211, 252, 0)");
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(cx, cy, r * 3.2, 0, Math.PI * 2);
        ctx.fill();
    }

    glowOn(ctx, "rgba(125, 211, 252, 0.9)", glow);
    ctx.strokeStyle = "rgba(234, 242, 251, 0.95)";
    ctx.lineWidth = (1.8 + 1.4 * glow) / k;
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ease(sweep));
    ctx.stroke();
    const arm = Math.min(r * 0.45, 14 / k) * ease((sweep - 0.5) * 2);
    if (arm > 0) {
        ctx.lineWidth = 1.8 / k;
        ctx.beginPath();
        ctx.moveTo(cx - arm, cy);
        ctx.lineTo(cx + arm, cy);
        ctx.moveTo(cx, cy - arm);
        ctx.lineTo(cx, cy + arm);
        ctx.stroke();
    }
    ctx.restore();
}

const ZONE_RINGS: ["r_zone1" | "r_zone2", string, string, string][] = [
    ["r_zone1", "Zone I · approx.", "rgba(167, 139, 250, 0.95)", "167, 139, 250"],
    ["r_zone2", "Zone II · approx.", "rgba(148, 163, 184, 0.9)", "148, 163, 184"],
];

export function drawZones(
    ctx: CanvasRenderingContext2D,
    eye: DemoEye,
    k: number,
    sweep: number,
    alpha: number,
    glow = 0,
): void {
    if (sweep <= 0 || alpha <= 0) return;
    const [cx, cy] = eye.zones.od_center;
    const top = eye.fov.cy - eye.fov.ry;
    const end = -Math.PI / 2 + Math.PI * 2 * ease(sweep);
    ctx.save();
    clipToRetina(ctx, eye);
    ctx.globalAlpha = alpha;

    // while a ring is being placed, a soft band of light follows it. A filled disc
    // would wash the photograph out and show its own edge.
    if (glow > 0) {
        ctx.lineCap = "butt";
        for (const [key, , , rgb] of ZONE_RINGS) {
            const r = eye.zones.rings[key];
            if (!r) continue;
            ctx.strokeStyle = `rgba(${rgb}, ${0.13 * glow})`;
            ctx.lineWidth = 26 / k;
            ctx.beginPath();
            ctx.arc(cx, cy, r, -Math.PI / 2, end);
            ctx.stroke();
        }
    }

    ctx.lineWidth = (1.5 + 1.3 * glow) / k;
    ctx.setLineDash([10 / k, 7 / k]);
    for (const [key, , colour, rgb] of ZONE_RINGS) {
        const r = eye.zones.rings[key];
        if (!r) continue;
        glowOn(ctx, `rgba(${rgb}, 0.95)`, glow);
        ctx.strokeStyle = colour;
        ctx.beginPath();
        ctx.arc(cx, cy, r, -Math.PI / 2, end);
        ctx.stroke();
    }
    ctx.restore();

    // The ring's name sits where it crosses the top of the retina.
    ctx.save();
    ctx.globalAlpha = alpha * ease((sweep - 0.6) / 0.4);
    for (const [key, name, colour] of ZONE_RINGS) {
        const r = eye.zones.rings[key];
        if (!r || cy - r < top) continue;
        label(ctx, name, cx, cy - r - 12 / k, k, colour);
    }
    ctx.restore();
}

export function drawQuadrants(
    ctx: CanvasRenderingContext2D,
    eye: DemoEye,
    k: number,
    reach: number,
    alpha: number,
    glow = 0,
): void {
    if (reach <= 0 || alpha <= 0) return;
    const { cx, cy } = eye.optic_disc;
    const span = Math.max(eye.image.width, eye.image.height) * 1.2;
    const far = span * ease(reach);
    const sign = eye.quadrants.orientation.temporal_x_sign;
    // +1 means temporal lies towards increasing x; superior is decreasing y
    const corner: Record<Quadrant, [number, number]> = {
        ST: [sign, -1],
        IT: [sign, 1],
        SN: [-sign, -1],
        IN: [-sign, 1],
    };

    ctx.save();
    clipToRetina(ctx, eye);
    ctx.globalAlpha = alpha;

    // while they are being placed, a pool of light sits in each abnormal quadrant
    if (glow > 0) {
        const reach = Math.max(eye.fov.rx, eye.fov.ry);
        for (const q of eye.abnormal_quadrants) {
            const [sx, sy] = corner[q];
            const px = cx + sx * reach * 0.42;
            const py = cy + sy * reach * 0.42;
            const pool = ctx.createRadialGradient(px, py, 0, px, py, reach * 0.62);
            pool.addColorStop(0, `rgba(251, 113, 133, ${0.16 * glow})`);
            pool.addColorStop(1, "rgba(251, 113, 133, 0)");
            ctx.fillStyle = pool;
            ctx.beginPath();
            ctx.arc(px, py, reach * 0.62, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    glowOn(ctx, "rgba(226, 232, 240, 0.7)", glow);
    ctx.strokeStyle = `rgba(226, 232, 240, ${0.4 + 0.25 * glow})`;
    ctx.lineWidth = (1.1 + 0.5 * glow) / k;
    ctx.setLineDash([4 / k, 6 / k]);
    ctx.beginPath();
    ctx.moveTo(cx - far, cy);
    ctx.lineTo(cx + far, cy);
    ctx.moveTo(cx, cy - far);
    ctx.lineTo(cx, cy + far);
    ctx.stroke();
    ctx.restore();

    const off = 160;
    ctx.save();
    ctx.globalAlpha = alpha * ease((reach - 0.5) * 2);
    for (const q of ["ST", "IT", "SN", "IN"] as Quadrant[]) {
        const [sx, sy] = corner[q];
        const abnormal = eye.abnormal_quadrants.includes(q);
        label(ctx, q, cx + sx * off, cy + sy * off, k, abnormal ? "rgba(251, 113, 133, 1)" : "rgba(226, 232, 240, 0.85)");
    }
    ctx.restore();
}

/** A small label on a dark pill, sized in screen pixels whatever the zoom. */
function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, k: number, colour: string): void {
    ctx.font = `500 ${12 / k}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const w = ctx.measureText(text).width + 14 / k;
    const h = 20 / k;
    ctx.fillStyle = "rgba(5, 7, 12, 0.78)";
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2);
    ctx.fill();
    ctx.fillStyle = colour;
    ctx.fillText(text, x, y + 0.5 / k);
}

/** The vessel under a point, or null when nothing is within `radius` (world px). */
export function vesselAt(vessels: Vessel[], x: number, y: number, radius: number): Vessel | null {
    let best: Vessel | null = null;
    let bestD = radius * radius;
    for (const v of vessels) {
        const p = v.segment.polyline;
        for (let i = 1; i < p.length; i++) {
            const [ax, ay] = p[i - 1];
            const [bx, by] = p[i];
            const dx = bx - ax;
            const dy = by - ay;
            const len = dx * dx + dy * dy || 1;
            const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len));
            const ex = ax + dx * t - x;
            const ey = ay + dy * t - y;
            const d = ex * ex + ey * ey;
            if (d < bestD) {
                bestD = d;
                best = v;
            }
        }
    }
    return best;
}
