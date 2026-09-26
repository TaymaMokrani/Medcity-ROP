import { useState } from "react";
import { CHART, SERIES_COLOURS } from "./tokens";
import { useWidth } from "./useWidth";
import { formatDate, formatShortDate } from "@/lib/format";

/**
 * Each baby's risk across their screenings.
 *
 * One line per baby, in its own colour, read left to right. A climbing line is
 * the only thing on this page that says a baby is getting worse, which a count
 * of flags cannot: two screenings at 30% and 39% are both "not flagged", and
 * together they are a trend.
 *
 * Babies screened once are drawn as a single point rather than dropped — a
 * first screening is still where a baby stands.
 */

export interface Trend {
    id: string;
    name: string;
    points: { date: string; risk: number }[];
}

export function RiskTrend({ series }: { series: Trend[] }) {
    const [ref, width] = useWidth<HTMLDivElement>();
    const [hover, setHover] = useState<{ id: string; index: number } | null>(null);

    const withPoints = series
        .filter((s) => s.points.length > 0)
        .map((s, i) => ({ ...s, colour: SERIES_COLOURS[i % SERIES_COLOURS.length] }));
    if (withPoints.length === 0) {
        return <p className="py-10 text-center text-body text-ink-3">No screenings recorded yet.</p>;
    }

    const height = 190;
    const pad = { top: 14, right: 14, bottom: 26, left: 44 };
    const plotW = Math.max(width - pad.left - pad.right, 10);
    const plotH = height - pad.top - pad.bottom;

    const times = withPoints.flatMap((s) => s.points.map((p) => new Date(p.date).getTime()));
    const first = Math.min(...times);
    const last = Math.max(...times);
    const span = Math.max(last - first, 1);

    const x = (date: string) =>
        pad.left + (first === last ? plotW / 2 : ((new Date(date).getTime() - first) / span) * plotW);
    const y = (risk: number) => pad.top + plotH - risk * plotH;

    const active = hover ? withPoints.find((s) => s.id === hover.id) : null;
    const activePoint = active?.points[hover!.index] ?? null;

    return (
        <div ref={ref} className="relative">
            {width > 0 && (
                <svg
                    width={width}
                    height={height}
                    role="img"
                    aria-label={`Risk over time for ${withPoints.length} patient${withPoints.length === 1 ? "" : "s"}`}
                >
                    {[0, 0.5, 1].map((tick) => (
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
                                x={pad.left - 8}
                                y={y(tick) + 4}
                                textAnchor="end"
                                className="fill-[var(--app-ink-3)] text-[11px] [font-variant-numeric:tabular-nums]"
                            >
                                {Math.round(tick * 100)}%
                            </text>
                        </g>
                    ))}

                    {withPoints.map((s) => {
                        const dim = hover !== null && hover.id !== s.id;
                        const path = s.points
                            .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.date)},${y(p.risk)}`)
                            .join(" ");
                        return (
                            <g key={s.id} opacity={dim ? 0.25 : 1}>
                                {s.points.length > 1 && (
                                    <path
                                        d={path}
                                        fill="none"
                                        stroke={s.colour}
                                        strokeWidth={hover?.id === s.id ? 2.4 : 1.6}
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    />
                                )}
                                {s.points.map((p, i) => (
                                    <circle
                                        key={`${p.date}-${i}`}
                                        cx={x(p.date)}
                                        cy={y(p.risk)}
                                        r={hover?.id === s.id && hover.index === i ? 5 : 3}
                                        fill={s.colour}
                                        stroke="var(--app-panel)"
                                        strokeWidth="1.5"
                                        onMouseEnter={() => setHover({ id: s.id, index: i })}
                                        onMouseLeave={() => setHover(null)}
                                    />
                                ))}
                            </g>
                        );
                    })}

                    {[first, last].map((time, i) => (
                        <text
                            key={time}
                            x={i === 0 ? pad.left : pad.left + plotW}
                            y={height - 8}
                            textAnchor={i === 0 ? "start" : "end"}
                            className="fill-[var(--app-ink-3)] text-[11px]"
                        >
                            {formatShortDate(new Date(time).toISOString().split("T")[0])}
                        </text>
                    ))}
                </svg>
            )}

            {active && activePoint && (
                <div
                    className="pointer-events-none absolute top-0 rounded-md border border-line bg-panel px-3 py-2 text-label shadow-sm"
                    style={{
                        left: Math.min(
                            Math.max(x(activePoint.date) - 60, 0),
                            Math.max(width - 150, 0),
                        ),
                    }}
                >
                    <p className="truncate text-ink">{active.name}</p>
                    <p className="mt-0.5 text-ink-3 tabular-nums">
                        {formatDate(activePoint.date)} · {Math.round(activePoint.risk * 100)}%
                    </p>
                </div>
            )}

            <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5">
                {withPoints.map((s) => (
                    <li
                        key={s.id}
                        className="flex items-center gap-2 text-label text-ink-3"
                        onMouseEnter={() => setHover({ id: s.id, index: s.points.length - 1 })}
                        onMouseLeave={() => setHover(null)}
                    >
                        <span
                            className="size-2 shrink-0 rounded-full"
                            style={{ background: s.colour }}
                        />
                        <span className={hover?.id === s.id ? "text-ink" : undefined}>{s.name}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}
