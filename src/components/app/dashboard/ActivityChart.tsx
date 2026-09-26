import { useState } from "react";
import { CHART } from "./tokens";
import { useWidth } from "./useWidth";
import { formatShortDate, formatDate } from "@/lib/format";

/**
 * Screenings per day.
 *
 * Every day between the first and the last is plotted, including the quiet
 * ones. The chart used to draw only the days that had a screening, side by
 * side, so a fortnight with nothing in it looked exactly like a busy one and
 * the axis was not really time.
 */
export function ActivityChart({ data }: { data: { date: string; count: number }[] }) {
    const [ref, width] = useWidth<HTMLDivElement>();
    const [hover, setHover] = useState<number | null>(null);

    const height = 190;
    const pad = { top: 12, right: 12, bottom: 26, left: 30 };

    if (data.length === 0) {
        return (
            <p className="py-10 text-center text-body text-ink-3">
                No screenings recorded yet.
            </p>
        );
    }

    const plotW = Math.max(width - pad.left - pad.right, 10);
    const plotH = height - pad.top - pad.bottom;
    const maxCount = Math.max(...data.map((d) => d.count), 1);
    const yMax = maxCount <= 2 ? 2 : maxCount <= 5 ? 5 : Math.ceil(maxCount / 5) * 5;
    const ticks = [0, yMax / 2, yMax];

    const x = (i: number) =>
        pad.left + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
    const y = (v: number) => pad.top + plotH - (v / yMax) * plotH;

    const linePath = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(d.count)}`).join(" ");
    const areaPath = `${linePath} L${x(data.length - 1)},${pad.top + plotH} L${x(0)},${
        pad.top + plotH
    } Z`;

    const active = hover !== null ? data[hover] : null;
    const peakIndex = data.reduce((best, d, i) => (d.count > data[best].count ? i : best), 0);

    return (
        <div ref={ref} className="relative">
            {width > 0 && (
                <svg
                    width={width}
                    height={height}
                    role="img"
                    aria-label={`Screenings per day, from ${data[0].date} to ${
                        data[data.length - 1].date
                    }`}
                >
                    {ticks.map((t) => (
                        <g key={t}>
                            <line
                                x1={pad.left}
                                x2={pad.left + plotW}
                                y1={y(t)}
                                y2={y(t)}
                                stroke={CHART.grid}
                                strokeWidth="1"
                            />
                            <text
                                x={pad.left - 8}
                                y={y(t) + 4}
                                textAnchor="end"
                                className="fill-[var(--app-ink-3)] text-[11px] [font-variant-numeric:tabular-nums]"
                            >
                                {t}
                            </text>
                        </g>
                    ))}

                    <path d={areaPath} fill={CHART.seriesWash} />
                    <path
                        d={linePath}
                        fill="none"
                        stroke={CHART.series}
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />

                    <text
                        x={x(peakIndex)}
                        y={y(data[peakIndex].count) - 10}
                        textAnchor="middle"
                        className="fill-[var(--app-ink-3)] text-[11px]"
                    >
                        {data[peakIndex].count}
                    </text>

                    <circle
                        cx={x(data.length - 1)}
                        cy={y(data[data.length - 1].count)}
                        r="4"
                        fill={CHART.series}
                        stroke="var(--app-panel)"
                        strokeWidth="2"
                    />

                    {hover !== null && (
                        <>
                            <line
                                x1={x(hover)}
                                x2={x(hover)}
                                y1={pad.top}
                                y2={pad.top + plotH}
                                stroke={CHART.axis}
                                strokeWidth="1"
                            />
                            <circle
                                cx={x(hover)}
                                cy={y(data[hover].count)}
                                r="4"
                                fill={CHART.series}
                                stroke="var(--app-panel)"
                                strokeWidth="2"
                            />
                        </>
                    )}

                    {data.map((d, i) => {
                        const show =
                            i === 0 ||
                            i === data.length - 1 ||
                            (data.length > 4 && i === Math.floor((data.length - 1) / 2));
                        if (!show) return null;
                        return (
                            <text
                                key={d.date}
                                x={x(i)}
                                y={height - 8}
                                textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"}
                                className="fill-[var(--app-ink-3)] text-[11px]"
                            >
                                {formatShortDate(d.date)}
                            </text>
                        );
                    })}

                    {data.map((d, i) => (
                        <rect
                            key={d.date}
                            x={x(i) - plotW / Math.max(data.length, 1) / 2}
                            y={pad.top}
                            width={plotW / Math.max(data.length, 1)}
                            height={plotH}
                            fill="transparent"
                            onMouseEnter={() => setHover(i)}
                            onMouseLeave={() => setHover(null)}
                        />
                    ))}
                </svg>
            )}

            {active && hover !== null && (
                <div
                    className="pointer-events-none absolute top-0 rounded-md border border-line bg-panel px-3 py-2 text-label shadow-sm"
                    style={{
                        left: Math.min(Math.max(x(hover) - 62, 0), Math.max(width - 132, 0)),
                    }}
                >
                    <p className="text-ink">{formatDate(active.date)}</p>
                    <p className="mt-0.5 text-ink-3">
                        {active.count} screening{active.count === 1 ? "" : "s"}
                    </p>
                </div>
            )}
        </div>
    );
}
