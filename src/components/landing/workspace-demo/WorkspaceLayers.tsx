import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { QUADRANT_NAMES, ctiArtefact, ctiReliable, fmt, heatColour, pxAndDd } from "@/lib/workspace";
import { cn } from "@/lib/utils";
import {
    PLAIN_RGB,
    clamp,
    drawDisc,
    drawQuadrants,
    drawZones,
    ease,
    fitView,
    frameOf,
    mix,
    toWorld,
    traceVessel,
    useDemoEye,
    vesselAt,
    type PreparedEye,
    type Vessel,
    type View,
} from "./eye";

/**
 * The Vessel Workspace, shown working on one real photo.
 *
 * A looping timeline: the vessels are traced out from the disc, turn to their
 * tortuosity colours, then the disc, the zones and the quadrants are placed. At
 * the end a cursor reads three vessels, and it starts again. The step that is
 * playing is highlighted on the left; clicking a step jumps to it. Hovering the
 * photo pauses the loop so the visitor can read any vessel themselves.
 */

interface Step {
    at: number;
    title: string;
    body: (eye: PreparedEye) => string;
}

const STEPS: Step[] = [
    {
        at: 0,
        title: "Start from one photo",
        body: () => "Open a saved exam, or import up to five photos per eye. This is one real retinal photo.",
    },
    {
        at: 2,
        title: "Every vessel, traced",
        body: (e) =>
            `${e.vessels.length} vessels are followed from the disc out to their tips, and measured along the way.`,
    },
    {
        at: 7.5,
        title: "Colored by how twisted it is",
        body: () => "Straight vessels stay blue. The more a vessel twists, the warmer it turns.",
    },
    {
        at: 11,
        title: "The optic disc, found",
        body: (e) =>
            `Found with ${Math.round(e.eye.optic_disc.confidence * 100)}% confidence. Its size sets the scale, so distances read in disc diameters.`,
    },
    {
        at: 14,
        title: "The zones, placed",
        body: () => "Zone I and Zone II are drawn around the disc. They show how far the vessels have grown.",
    },
    {
        at: 17.5,
        title: "Four quadrants, compared",
        body: (e) =>
            `The retina is split into four. Here, ${e.eye.abnormal_quadrants.length} quadrants have vessels that are both wider and more twisted.`,
    },
    {
        at: 21,
        title: "Read any vessel",
        body: () => "Point at a vessel to read its tortuosity, width and length. Hover the photo to try it.",
    },
];

const LOOP = 32;
/** The whole tree grows inside this window, at one speed. */
const GROW = { at: 2.3, window: 4.8 };
const HEAT_AT = 7.8;
const DISC = [11.2, 12.4];
const ZONES = [14.2, 15.8];
const QUADS = [17.7, 18.9];
const FADE = [30.3, 31.4];

/** The demo cursor: where it arrives, and how long it stays on each vessel. */
const TOUR = [
    { arrive: 22.0, leave: 24.0 },
    { arrive: 24.8, leave: 26.8 },
    { arrive: 27.6, leave: 29.4 },
];
const TOUR_IN = 21.2;
const TOUR_OUT = 30.2;

const between = (t: number, [a, b]: number[]) => clamp((t - a) / (b - a));

/** A layer glows while it is placed, holds briefly, then settles. */
const glowOf = (t: number, [a, b]: number[]) => Math.min(clamp((t - a) / 0.35), clamp((b + 1 - t) / 0.8));

function stepAt(t: number): number {
    let i = 0;
    while (i + 1 < STEPS.length && t >= STEPS[i + 1].at) i++;
    return i;
}

/** Three vessels worth reading: the most twisted, a straight one, and one between. */
function pickTour(eye: PreparedEye): Vessel[] {
    const { cx, cy, rx, ry } = eye.eye.fov;
    const candidates = eye.vessels.filter((v) => {
        if (v.heat === null || !ctiReliable(v.segment) || (v.segment.length_px ?? 0) < 70) return false;
        const [mx, my] = midpoint(v);
        return ((mx - cx) / rx) ** 2 + ((my - cy) / ry) ** 2 < 0.55;
    });
    const byHeat = [...candidates].sort((a, b) => b.heat! - a.heat!);
    const chosen: Vessel[] = [];
    const farEnough = (v: Vessel) =>
        chosen.every((c) => {
            const [ax, ay] = midpoint(c);
            const [bx, by] = midpoint(v);
            return Math.hypot(ax - bx, ay - by) > 320;
        });
    for (const pool of [byHeat, [...byHeat].reverse(), [...byHeat].sort((a, b) => Math.abs(a.heat! - 0.5) - Math.abs(b.heat! - 0.5))]) {
        const v = pool.find((p) => !chosen.includes(p) && farEnough(p));
        if (v) chosen.push(v);
    }
    // visit them in a smooth sweep rather than zig-zagging
    return chosen.sort((a, b) => midpoint(a)[0] - midpoint(b)[0]);
}

function midpoint(v: Vessel): [number, number] {
    const half = v.total / 2;
    const p = v.segment.polyline;
    for (let i = 1; i < p.length; i++) {
        if (v.cum[i] >= half) {
            const t = (half - v.cum[i - 1]) / (v.cum[i] - v.cum[i - 1] || 1);
            return [p[i - 1][0] + (p[i][0] - p[i - 1][0]) * t, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * t];
        }
    }
    return [p[0][0], p[0][1]];
}

type Leg = { from: [number, number]; to: [number, number]; t0: number; t1: number };

/** The demo cursor's path: out to each vessel in turn, then away. */
function tourLegs(stops: [number, number][], rest: [number, number]): Leg[] {
    const legs: Leg[] = [];
    let prev = rest;
    let prevT = TOUR_IN;
    TOUR.forEach((stop, i) => {
        legs.push({ from: prev, to: stops[i] ?? rest, t0: prevT, t1: stop.arrive });
        prev = stops[i] ?? rest;
        prevT = stop.leave;
    });
    legs.push({ from: prev, to: rest, t0: prevT, t1: TOUR_OUT });
    return legs;
}

/** Where the demo cursor is, in world pixels, and which vessel it is reading. */
function tourAt(t: number, stops: [number, number][], legs: Leg[]) {
    if (t < TOUR_IN || t > TOUR_OUT || stops.length === 0) return null;
    for (let i = 0; i < TOUR.length && i < stops.length; i++) {
        if (t >= TOUR[i].arrive && t <= TOUR[i].leave) return { at: stops[i], reading: i, alpha: 1 };
    }
    for (const leg of legs) {
        if (t >= leg.t0 && t <= leg.t1) {
            const raw = (t - leg.t0) / (leg.t1 - leg.t0);
            const e = ease(raw) * 0.5 + 0.5 * raw;
            const at: [number, number] = [
                leg.from[0] + (leg.to[0] - leg.from[0]) * e,
                leg.from[1] + (leg.to[1] - leg.from[1]) * e,
            ];
            const alpha = Math.min(clamp((t - TOUR_IN) / 0.4), clamp((TOUR_OUT - t) / 0.4));
            return { at, reading: -1, alpha };
        }
    }
    return null;
}

interface Hover {
    v: Vessel;
    x: number;
    y: number;
}

export default function WorkspaceLayers() {
    const stageRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const cursorRef = useRef<HTMLDivElement>(null);
    const barRefs = useRef<(HTMLSpanElement | null)[]>([]);
    const clock = useRef({ started: 0, pausedAt: null as number | null, jump: null as number | null });
    const userHover = useRef<Vessel | null>(null);
    const pointerInside = useRef(false);
    const onScreen = useRef(false);
    const viewRef = useRef<View | null>(null);

    const eye = useDemoEye();
    const tour = useMemo(() => (eye ? pickTour(eye) : []), [eye]);
    const [step, setStep] = useState(0);
    const [size, setSize] = useState({ w: 0, h: 0 });
    const [hover, setHover] = useState<Hover | null>(null);
    const [demoHover, setDemoHover] = useState<Hover | null>(null);

    useEffect(() => {
        const stage = stageRef.current;
        if (!stage) return;
        const observer = new ResizeObserver(([entry]) => {
            setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
        });
        observer.observe(stage);
        return () => observer.disconnect();
    }, [eye]);

    useEffect(() => {
        const canvas = canvasRef.current;
        const stage = stageRef.current;
        if (!eye || !canvas || !stage || !size.w) return;
        const ctx = canvas.getContext("2d")!;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(size.w * dpr);
        canvas.height = Math.round(size.h * dpr);
        const view = fitView(eye.eye, size.w, size.h);
        viewRef.current = view;
        const { k } = view;
        const toScreen = ([x, y]: [number, number]): [number, number] => [x * k + view.tx, y * k + view.ty];

        const photo = new Image();
        photo.src = "/demo/demo-eye.jpg";
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const stops = tour.map(midpoint);
        const rest: [number, number] = [eye.eye.fov.cx + eye.eye.fov.rx * 0.75, eye.eye.fov.cy + eye.eye.fov.ry * 0.9];
        const legs = tourLegs(stops, rest);

        let raf = 0;
        let shownStep = -1;
        let shownDemo = -2;

        const paint = (t: number) => {
            const fade = 1 - between(t, FADE);
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * view.tx, dpr * view.ty);

            const traced = clamp((t - GROW.at) / 1.5);
            if (photo.complete && photo.naturalWidth) {
                // the photo steps back as the measurements come forward, and returns for the next loop
                ctx.globalAlpha = 1 - 0.32 * traced * fade;
                ctx.drawImage(photo, 0, 0, eye.eye.image.width, eye.eye.image.height);
                ctx.globalAlpha = 1;
            }

            const glows = [glowOf(t, DISC), glowOf(t, ZONES), glowOf(t, QUADS)];
            // while a layer glows, the vessels step back so it stands out
            const spotlight = 1 - 0.45 * Math.max(...glows);

            drawQuadrants(ctx, eye.eye, k, between(t, QUADS), fade, glows[2]);
            drawZones(ctx, eye.eye, k, between(t, ZONES), fade, glows[1]);

            // the demo cursor stands down while the visitor is reading for themselves
            const tourStop = pointerInside.current ? null : tourAt(t, stops, legs);
            const focus = userHover.current ?? (tourStop && tourStop.reading >= 0 ? tour[tourStop.reading] : null);

            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.lineWidth = 2.2 / k;
            const tips: [number, number][] = [];
            for (const v of eye.vessels) {
                if (v === focus) continue;
                const frac = clamp((t - GROW.at - v.begin * GROW.window) / (v.grow * GROW.window));
                if (frac <= 0) continue;
                const heat = clamp((t - HEAT_AT - v.start * 1.1) / 0.8);
                ctx.strokeStyle = mix(PLAIN_RGB, v.rgb, heat, (focus ? 0.35 : 0.95) * fade * spotlight);
                const tip = traceVessel(ctx, v, frac);
                ctx.stroke();
                if (frac < 1) tips.push(tip);
            }

            // a small light at each growing tip
            ctx.fillStyle = `rgba(234, 249, 255, ${0.9 * fade})`;
            for (const [x, y] of tips) {
                ctx.beginPath();
                ctx.arc(x, y, 2.4 / k, 0, Math.PI * 2);
                ctx.fill();
            }

            if (focus) {
                traceVessel(ctx, focus);
                ctx.strokeStyle = "rgba(5, 7, 12, 0.9)";
                ctx.lineWidth = 7 / k;
                ctx.stroke();
                ctx.strokeStyle = mix(PLAIN_RGB, focus.rgb, clamp((t - HEAT_AT) / 2));
                ctx.lineWidth = 3.4 / k;
                ctx.stroke();
            }

            drawDisc(ctx, eye.eye, k, between(t, DISC), fade, glows[0]);

            // the demo cursor
            const cursor = cursorRef.current;
            if (cursor) {
                if (tourStop) {
                    const [sx, sy] = toScreen(tourStop.at);
                    cursor.style.opacity = String(tourStop.alpha);
                    cursor.style.transform = `translate(${sx}px, ${sy}px)`;
                } else {
                    cursor.style.opacity = "0";
                }
            }
            const reading = tourStop ? tourStop.reading : -1;
            if (reading !== shownDemo) {
                shownDemo = reading;
                if (reading >= 0) {
                    const [sx, sy] = toScreen(stops[reading]);
                    setDemoHover({ v: tour[reading], x: sx, y: sy });
                } else setDemoHover(null);
            }

            const s = stepAt(t);
            if (s !== shownStep) {
                shownStep = s;
                setStep(s);
            }
            barRefs.current.forEach((bar, i) => {
                if (!bar) return;
                const end = STEPS[i + 1]?.at ?? LOOP;
                bar.style.transform = `scaleY(${clamp((t - STEPS[i].at) / (end - STEPS[i].at))})`;
            });
        };

        const now = () => performance.now() / 1000;
        const timeNow = () => {
            const c = clock.current;
            if (c.jump !== null) {
                c.started = now() - c.jump;
                c.jump = null;
            }
            if (c.pausedAt !== null) return c.pausedAt;
            return (now() - c.started) % LOOP;
        };

        const tick = () => {
            paint(reduced ? 20.5 : timeNow());
            if (onScreen.current && !reduced) raf = requestAnimationFrame(tick);
        };

        photo.onload = () => paint(reduced ? 20.5 : timeNow());
        paint(reduced ? 20.5 : timeNow());
        if (onScreen.current && !reduced) raf = requestAnimationFrame(tick);

        const watcher = new IntersectionObserver(
            ([entry]) => {
                const was = onScreen.current;
                onScreen.current = entry.isIntersecting;
                if (entry.isIntersecting && !was) {
                    // every visit starts from the photo
                    clock.current.started = now();
                    clock.current.pausedAt = null;
                    cancelAnimationFrame(raf);
                    raf = requestAnimationFrame(tick);
                }
            },
            { threshold: 0.35 },
        );
        watcher.observe(stage);

        return () => {
            cancelAnimationFrame(raf);
            watcher.disconnect();
            photo.onload = null;
        };
    }, [eye, size, tour]);

    const jumpTo = (i: number) => {
        clock.current.pausedAt = null;
        clock.current.jump = STEPS[i].at + 0.01;
    };

    const onPointer = (event: React.PointerEvent) => {
        const view = viewRef.current;
        if (!eye || !view) return;
        const c = clock.current;
        const at = c.pausedAt ?? (performance.now() / 1000 - c.started) % LOOP;
        // nothing to read until the vessels have been traced: let the loop run on
        if (at < GROW.at + 2) return;
        pointerInside.current = true;
        c.pausedAt = at;
        const rect = event.currentTarget.getBoundingClientRect();
        const sx = event.clientX - rect.left;
        const sy = event.clientY - rect.top;
        const [wx, wy] = toWorld(view, sx, sy);
        const v = vesselAt(eye.vessels, wx, wy, 9 / view.k);
        userHover.current = v;
        setHover(v ? { v, x: sx, y: sy } : null);
    };

    const onLeave = () => {
        const c = clock.current;
        if (c.pausedAt !== null) {
            c.started = performance.now() / 1000 - c.pausedAt;
            c.pausedAt = null;
        }
        pointerInside.current = false;
        userHover.current = null;
        setHover(null);
    };

    // A finger never fires pointerleave, so a tap has to let the loop go again itself.
    const onRelease = (event: React.PointerEvent) => {
        if (event.pointerType !== "mouse") onLeave();
    };

    const box = eye ? frameOf(eye.eye) : { w: 4, h: 3 };
    const card = hover ?? demoHover;

    return (
        <section id="workspace" className="relative overflow-hidden px-6 py-32">
            <div className="pointer-events-none absolute right-[6%] top-1/2 h-[60vh] w-[50vw] -translate-y-1/2 rounded-full bg-medcity-cyan/[0.07] blur-[140px]" />

            <div className="relative mx-auto grid w-full max-w-7xl items-center gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
                <motion.div
                    initial={{ opacity: 0, y: 24 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, amount: 0.3 }}
                    transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                    className="order-2 lg:order-1"
                >
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-medcity-cyan">
                        Vessel Workspace
                    </p>
                    <h2 className="mt-4 text-[clamp(1.9rem,3.2vw,2.5rem)] font-semibold leading-[1.1] tracking-[-0.02em] text-medcity-ice">
                        See what the measurements see.
                    </h2>

                    <ol className="mt-10 flex flex-col">
                        {STEPS.map((s, i) => {
                            const active = i === step;
                            return (
                                <li key={s.title}>
                                    <button
                                        type="button"
                                        onClick={() => jumpTo(i)}
                                        aria-current={active ? "step" : undefined}
                                        className="group flex w-full cursor-pointer gap-4 text-left"
                                    >
                                        <span className="relative w-px shrink-0 bg-white/10">
                                            <span
                                                ref={(el) => {
                                                    barRefs.current[i] = el;
                                                }}
                                                className={cn(
                                                    "absolute inset-0 origin-top bg-medcity-cyan transition-opacity duration-500",
                                                    active ? "opacity-100" : "opacity-0",
                                                )}
                                                style={{ transform: "scaleY(0)" }}
                                            />
                                        </span>
                                        <span className="flex-1 py-2.5">
                                            <span className="flex items-baseline gap-3">
                                                <span
                                                    className={cn(
                                                        "text-xs tabular-nums transition-colors duration-500",
                                                        active ? "text-medcity-cyan" : "text-medcity-muted/50",
                                                    )}
                                                >
                                                    {String(i + 1).padStart(2, "0")}
                                                </span>
                                                <span
                                                    className={cn(
                                                        "text-lg font-medium tracking-[-0.01em] transition-colors duration-500",
                                                        active
                                                            ? "text-medcity-ice"
                                                            : "text-medcity-muted/60 group-hover:text-medcity-muted",
                                                    )}
                                                >
                                                    {s.title}
                                                </span>
                                            </span>
                                            <span
                                                className={cn(
                                                    "grid transition-[grid-template-rows,opacity] duration-500 ease-out",
                                                    active ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
                                                )}
                                            >
                                                <span className="overflow-hidden">
                                                    <span className="block max-w-md pl-8 pt-2 text-[15px] leading-relaxed text-medcity-muted">
                                                        {eye ? s.body(eye) : ""}
                                                    </span>
                                                    {i === 2 && <HeatLegend />}
                                                </span>
                                            </span>
                                        </span>
                                    </button>
                                </li>
                            );
                        })}
                    </ol>
                </motion.div>

                <div className="order-1 lg:order-2">
                    <div className="relative rounded-[1.4rem] border border-white/10 bg-white/[0.04] p-2 shadow-[0_50px_140px_-24px_rgba(0,0,0,0.75)]">
                        <div className="pointer-events-none absolute inset-x-0 top-0 h-px rounded-t-[1.4rem] bg-gradient-to-r from-transparent via-white/25 to-transparent" />
                        <div
                            ref={stageRef}
                            className="relative w-full cursor-crosshair overflow-hidden rounded-[1rem] bg-black"
                            style={{ aspectRatio: `${box.w} / ${box.h}`, maxHeight: "76vh" }}
                            onPointerMove={onPointer}
                            onPointerDown={onPointer}
                            onPointerUp={onRelease}
                            onPointerCancel={onRelease}
                            onPointerLeave={onLeave}
                        >
                            <canvas
                                ref={canvasRef}
                                role="img"
                                aria-label="A retinal photograph with its vessels traced and coloured by how twisted each one is, and the optic disc, zones and quadrants drawn on top."
                                className="absolute inset-0 h-full w-full"
                            />
                            <DemoCursor ref={cursorRef} />
                            {card && eye && (
                                <VesselCard
                                    key={card.v.segment.id}
                                    vessel={card.v}
                                    x={card.x}
                                    y={card.y}
                                    bounds={size}
                                    ddPx={eye.eye.optic_disc.dd_px}
                                />
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}

function DemoCursor({ ref }: { ref: React.Ref<HTMLDivElement> }) {
    return (
        <div
            ref={ref}
            aria-hidden
            className="pointer-events-none absolute left-0 top-0 z-10"
            style={{ opacity: 0, willChange: "transform" }}
        >
            <svg width="20" height="22" viewBox="0 0 20 22" className="-translate-x-[3px] -translate-y-[2px] drop-shadow-[0_4px_10px_rgba(0,0,0,0.6)]">
                <path d="M3 2 L3 18 L7.5 13.8 L10.6 20.5 L13.4 19.2 L10.4 12.7 L16.5 12.4 Z" fill="#eaf2fb" stroke="#05070c" strokeWidth="1.3" strokeLinejoin="round" />
            </svg>
        </div>
    );
}

function HeatLegend() {
    const stops = [0, 0.35, 0.6, 0.8, 1].map((h) => `${heatColour(h)} ${h * 100}%`).join(", ");
    return (
        <span className="block max-w-xs pl-8 pt-4">
            <span className="block h-1.5 rounded-full" style={{ background: `linear-gradient(90deg, ${stops})` }} />
            <span className="mt-2 flex justify-between text-xs text-medcity-muted">
                <span>straight</span>
                <span>twisted</span>
            </span>
        </span>
    );
}

const CARD_W = 256;
const CARD_H = 118;
const GAP = 18;

function VesselCard({
    vessel,
    x,
    y,
    bounds,
    ddPx,
}: {
    vessel: Vessel;
    x: number;
    y: number;
    bounds: { w: number; h: number };
    ddPx: number;
}) {
    const s = vessel.segment;
    const left = x + GAP + CARD_W > bounds.w ? Math.max(8, x - GAP - CARD_W) : x + GAP;
    const top = y + GAP + CARD_H > bounds.h ? Math.max(8, y - GAP - CARD_H) : y + GAP;
    const q = s.location?.quadrant;
    const place = [q ? QUADRANT_NAMES[q] : null, s.location?.zone_geom ? `Zone ${s.location.zone_geom}` : null]
        .filter(Boolean)
        .join(" · ");

    return (
        <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="pointer-events-none absolute z-20 rounded-xl border border-white/10 bg-[#05070c]/90 px-3.5 py-3 shadow-[0_18px_50px_-18px_rgba(0,0,0,0.9)] backdrop-blur-md"
            style={{ left, top, width: CARD_W }}
        >
            <div className="flex items-center gap-2">
                <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: vessel.heat === null ? "#94a3b8" : heatColour(vessel.heat) }}
                />
                <span className="text-[13px] font-medium text-medcity-ice">Vessel #{s.id}</span>
                {place && <span className="truncate text-[11px] text-medcity-muted">{place}</span>}
            </div>
            <dl className="mt-2.5 grid grid-cols-[4.75rem_1fr] gap-x-2 gap-y-1 text-[12px]">
                <dt className="text-medcity-muted">Tortuosity</dt>
                <dd className="tabular-nums text-medcity-ice">
                    {ctiArtefact(s) ? (
                        <span className="text-amber-200/90">not reliable · looped</span>
                    ) : ctiReliable(s) ? (
                        <>
                            CTI {fmt(s.tortuosity?.CTI, 3)}
                            <span className="text-medcity-muted"> · curv. {fmt(s.tortuosity?.ICLc, 3)}</span>
                        </>
                    ) : (
                        <>
                            <span className="text-medcity-muted">CTI n/a · </span>curv. {fmt(s.tortuosity?.ICLc, 3)}
                        </>
                    )}
                </dd>
                <dt className="text-medcity-muted">Width</dt>
                <dd className="tabular-nums text-medcity-ice">
                    {s.caliber?.diameter_px ? `${s.caliber.diameter_px.toFixed(1)} px` : "—"}
                </dd>
                <dt className="text-medcity-muted">Length</dt>
                <dd className="tabular-nums text-medcity-ice">
                    {pxAndDd(s.length_px ?? 0, { ddPx, borrowedFrom: null })}
                </dd>
            </dl>
        </motion.div>
    );
}
