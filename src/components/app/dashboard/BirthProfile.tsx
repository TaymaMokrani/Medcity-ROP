import { useState } from "react";
import { CHART } from "./tokens";
import { useWidth } from "./useWidth";

/**
 * Who this unit screens: how early they were born, and how small.
 *
 * Both are histograms of babies, not screenings, and each bar is split — the
 * darker part is the babies whose screening came back flagged. The two
 * together are the population ROP is read against, and they are the first
 * thing anybody asks a screening service.
 */

export interface Baby {
    gestationalAge: number;
    birthWeight: number;
    flagged: boolean;
}

interface Bin {
    label: string;
    total: number;
    flagged: number;
}

function bin(values: { value: number; flagged: boolean }[], step: number, label: (low: number) => string): Bin[] {
    const usable = values.filter((v) => Number.isFinite(v.value) && v.value > 0);
    if (usable.length === 0) return [];
    const low = Math.floor(Math.min(...usable.map((v) => v.value)) / step) * step;
    const high = Math.floor(Math.max(...usable.map((v) => v.value)) / step) * step;
    const bins: Bin[] = [];
    for (let edge = low; edge <= high; edge += step) {
        const inside = usable.filter((v) => v.value >= edge && v.value < edge + step);
        bins.push({
            label: label(edge),
            total: inside.length,
            flagged: inside.filter((v) => v.flagged).length,
        });
    }
    return bins;
}

export function BirthProfile({ babies }: { babies: Baby[] }) {
    if (babies.length === 0) {
        return <p className="py-10 text-center text-body text-ink-3">No patients on record yet.</p>;
    }

    const weeks = bin(
        babies.map((b) => ({ value: b.gestationalAge, flagged: b.flagged })),
        1,
        (low) => `${low}w`,
    );
    const grams = bin(
        babies.map((b) => ({ value: b.birthWeight, flagged: b.flagged })),
        250,
        (low) => `${low}`,
    );

    return (
        <div>
            {/* the same seam as the rows above, so the page reads as one grid */}
            <div className="grid gap-x-10 gap-y-8 lg:grid-cols-12">
                <Histogram
                    className="lg:col-span-7"
                    title="Gestational age at birth"
                    unit="weeks"
                    bins={weeks}
                    describe={(b) => `${b.label} · ${b.total} bab${b.total === 1 ? "y" : "ies"}`}
                />
                <Histogram
                    className="lg:col-span-5 lg:border-l lg:border-line lg:pl-10"
                    title="Birth weight"
                    unit="grams"
                    bins={grams}
                    describe={(b) =>
                        `${b.label}–${Number(b.label) + 250} g · ${b.total} bab${b.total === 1 ? "y" : "ies"}`
                    }
                />
            </div>

            <div className="mt-6 flex items-center gap-5 text-label text-ink-3">
                <span className="flex items-center gap-2">
                    <span className="size-2 rounded-full" style={{ background: CHART.series }} />
                    Flagged
                </span>
                <span className="flex items-center gap-2">
                    <span className="size-2 rounded-full" style={{ background: CHART.muted }} />
                    Not flagged
                </span>
            </div>
        </div>
    );
}

function Histogram({
    title,
    unit,
    bins,
    describe,
    className = "",
}: {
    title: string;
    unit: string;
    bins: Bin[];
    describe: (bin: Bin) => string;
    className?: string;
}) {
    const [ref, width] = useWidth<HTMLDivElement>();
    const [hover, setHover] = useState<number | null>(null);

    const height = 170;
    const pad = { top: 12, right: 10, bottom: 24, left: 26 };
    const plotW = Math.max(width - pad.left - pad.right, 10);
    const plotH = height - pad.top - pad.bottom;

    const max = Math.max(...bins.map((b) => b.total), 1);
    const yMax = max <= 2 ? 2 : max <= 5 ? 5 : Math.ceil(max / 5) * 5;
    const y = (v: number) => pad.top + plotH - (v / yMax) * plotH;
    const slot = bins.length > 0 ? plotW / bins.length : plotW;
    const barW = Math.max(Math.min(slot - 6, 46), 4);

    return (
        <div className={className}>
            <p className="text-label text-ink-2">
                {title} <span className="text-ink-3">· {unit}</span>
            </p>

            <div ref={ref} className="relative mt-2">
                {width > 0 && bins.length > 0 && (
                    <svg
                        width={width}
                        height={height}
                        role="img"
                        aria-label={`${title}: ${bins.map((b) => `${b.label}, ${b.total}`).join("; ")}`}
                    >
                        {[0, yMax].map((tick) => (
                            <g key={tick}>
                                <line
                                    x1={pad.left}
                                    x2={pad.left + plotW}
                                    y1={y(tick)}
                                    y2={y(tick)}
                                    stroke={CHART.grid}
                                    strokeWidth="1"
                                />
                                <text
                                    x={pad.left - 6}
                                    y={y(tick) + 4}
                                    textAnchor="end"
                                    className="fill-[var(--app-ink-3)] text-[11px] [font-variant-numeric:tabular-nums]"
                                >
                                    {tick}
                                </text>
                            </g>
                        ))}

                        {bins.map((b, i) => {
                            const x = pad.left + i * slot + (slot - barW) / 2;
                            const flaggedH = Math.max(y(0) - y(b.flagged), 0);
                            const totalH = Math.max(y(0) - y(b.total), 0);
                            const dim = hover !== null && hover !== i;
                            return (
                                <g
                                    key={b.label}
                                    opacity={dim ? 0.5 : 1}
                                    onMouseEnter={() => setHover(i)}
                                    onMouseLeave={() => setHover(null)}
                                >
                                    <rect
                                        x={x}
                                        y={y(b.total)}
                                        width={barW}
                                        height={Math.max(totalH, b.total > 0 ? 1 : 0)}
                                        rx="2"
                                        fill={CHART.muted}
                                    />
                                    {b.flagged > 0 && (
                                        <rect
                                            x={x}
                                            y={y(b.flagged)}
                                            width={barW}
                                            height={Math.max(flaggedH, 1)}
                                            rx="2"
                                            fill={CHART.series}
                                        />
                                    )}
                                    <rect
                                        x={pad.left + i * slot}
                                        y={pad.top}
                                        width={slot}
                                        height={plotH}
                                        fill="transparent"
                                    />
                                    <text
                                        x={x + barW / 2}
                                        y={height - 8}
                                        textAnchor="middle"
                                        className="fill-[var(--app-ink-3)] text-[10px]"
                                    >
                                        {bins.length > 8 && i % 2 === 1 ? "" : b.label}
                                    </text>
                                </g>
                            );
                        })}
                    </svg>
                )}

                {hover !== null && bins[hover] && (
                    <div
                        className="pointer-events-none absolute top-0 rounded-md border border-line bg-panel px-3 py-2 text-label shadow-sm"
                        style={{
                            left: Math.min(
                                Math.max(pad.left + hover * slot - 30, 0),
                                Math.max(width - 150, 0),
                            ),
                        }}
                    >
                        <p className="text-ink tabular-nums">{describe(bins[hover])}</p>
                        <p className="mt-0.5 text-ink-3 tabular-nums">
                            {bins[hover].flagged} flagged
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
