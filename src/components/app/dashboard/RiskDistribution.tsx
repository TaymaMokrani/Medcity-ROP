import { useState } from "react";
import { CHART } from "./tokens";
import { useWidth } from "./useWidth";

/**
 * Where the risks fall.
 *
 * One bar per tenth of the scale, counting eyes rather than screenings: a baby
 * screened on both eyes has two answers, and they are often different. Each bar
 * carries its count, so the chart can be read without hovering anything.
 */

const BUCKETS = 10;

export function RiskDistribution({ risks }: { risks: number[] }) {
    const [ref, width] = useWidth<HTMLDivElement>();
    const [hover, setHover] = useState<number | null>(null);

    if (risks.length === 0) {
        return <p className="py-10 text-center text-body text-ink-3">No eyes scored yet.</p>;
    }

    const counts = new Array<number>(BUCKETS).fill(0);
    for (const risk of risks) {
        const index = Math.min(BUCKETS - 1, Math.max(0, Math.floor(risk * BUCKETS)));
        counts[index] += 1;
    }

    const height = 190;
    const pad = { top: 14, right: 12, bottom: 26, left: 30 };
    const plotW = Math.max(width - pad.left - pad.right, 10);
    const plotH = height - pad.top - pad.bottom;

    const max = Math.max(...counts, 1);
    const yMax = max <= 2 ? 2 : max <= 5 ? 5 : Math.ceil(max / 5) * 5;
    const y = (v: number) => pad.top + plotH - (v / yMax) * plotH;
    const slot = plotW / BUCKETS;
    const barW = Math.max(slot - 6, 4);

    return (
        <div ref={ref} className="relative">
            {width > 0 && (
                <svg
                    width={width}
                    height={height}
                    role="img"
                    aria-label={`Risk distribution of ${risks.length} eyes: ${counts
                        .map((count, i) => `${i * 10}–${i * 10 + 10}%, ${count}`)
                        .join("; ")}`}
                >
                    {[0, yMax / 2, yMax].map((tick) => (
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
                                {tick}
                            </text>
                        </g>
                    ))}

                    {counts.map((count, i) => (
                        <g
                            key={i}
                            opacity={hover === null || hover === i ? 1 : 0.55}
                            onMouseEnter={() => setHover(i)}
                            onMouseLeave={() => setHover(null)}
                        >
                            <rect
                                x={pad.left + i * slot + (slot - barW) / 2}
                                y={count === 0 ? y(0) - 1 : y(count)}
                                width={barW}
                                height={count === 0 ? 1 : Math.max(y(0) - y(count), 1)}
                                rx="2"
                                fill={CHART.series}
                            />
                            {count > 0 && (
                                <text
                                    x={pad.left + i * slot + slot / 2}
                                    y={y(count) - 6}
                                    textAnchor="middle"
                                    className="fill-[var(--app-ink-3)] text-[11px] [font-variant-numeric:tabular-nums]"
                                >
                                    {count}
                                </text>
                            )}
                            <rect
                                x={pad.left + i * slot}
                                y={pad.top}
                                width={slot}
                                height={plotH}
                                fill="transparent"
                            />
                        </g>
                    ))}

                    {[0, 0.25, 0.5, 0.75, 1].map((t) => (
                        <text
                            key={t}
                            x={pad.left + t * plotW}
                            y={height - 8}
                            textAnchor={t === 0 ? "start" : t === 1 ? "end" : "middle"}
                            className="fill-[var(--app-ink-3)] text-[11px]"
                        >
                            {Math.round(t * 100)}%
                        </text>
                    ))}
                </svg>
            )}

            {hover !== null && (
                <div
                    className="pointer-events-none absolute top-0 rounded-md border border-line bg-panel px-3 py-2 text-label shadow-sm"
                    style={{
                        left: Math.min(
                            Math.max(pad.left + hover * slot - 40, 0),
                            Math.max(width - 130, 0),
                        ),
                    }}
                >
                    <p className="text-ink tabular-nums">
                        {hover * 10}–{hover * 10 + 10}% risk
                    </p>
                    <p className="mt-0.5 text-ink-3">
                        {counts[hover]} eye{counts[hover] === 1 ? "" : "s"}
                    </p>
                </div>
            )}
        </div>
    );
}
