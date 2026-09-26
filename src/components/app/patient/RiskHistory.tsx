import { useState } from "react";
import { CHART } from "@/components/app/dashboard/tokens";
import { useWidth } from "@/components/app/dashboard/useWidth";
import { Eyebrow } from "@/components/ui";
import { formatDate, formatShortDate } from "@/lib/format";
import { formatRisk, type Detection } from "@/lib/detections";

/**
 * What the model said, screening by screening, for one baby.
 *
 * The list above it gives seven percentages as seven separate numbers, and
 * nobody can tell from that whether a baby is getting worse or holding steady.
 * This is the one thing a flat list cannot say.
 *
 * The axis is the order the screenings were taken in, not the calendar. Four of
 * them can fall on the same morning, and on a real date axis those four would
 * land on top of each other as a single dot. The dates are on the axis and in
 * the tooltip, so the gaps are still readable.
 *
 * Colour follows `lib/threshold`: it belongs above the model's line, and below
 * it a number is just a number.
 */
export default function RiskHistory({ detections }: { detections: Detection[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  // Oldest first, because a trend reads left to right.
  const points = [...detections].sort((a, b) => a.date.localeCompare(b.date));

  // One screening is not a trend, and drawing it as one would be a line
  // through a single point.
  if (points.length < 2) return null;

  const height = 200;
  const pad = { top: 16, right: 16, bottom: 28, left: 40 };
  const plotW = Math.max(width - pad.left - pad.right, 10);
  const plotH = height - pad.top - pad.bottom;

  const x = (i: number) => pad.left + (i / (points.length - 1)) * plotW;
  const y = (risk: number) => pad.top + plotH - risk * plotH;

  const linePath = points
    .map((d, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(d.risk)}`)
    .join(" ");

  const active = hover !== null ? points[hover] : null;

  return (
    <section className="overflow-hidden rounded-xl border border-line bg-panel">
      <header className="border-b border-line px-5 py-4">
        <Eyebrow>Risk over time</Eyebrow>
      </header>

      <div className="px-5 py-4">
        <div ref={ref} className="relative">
        {width > 0 && (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={`The model's risk across ${points.length} screenings, from ${formatDate(points[0].date)} to ${formatDate(points[points.length - 1].date)}`}
          >
            {[0, 0.5, 1].map((t) => (
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
                  {t * 100}%
                </text>
              </g>
            ))}

            <path
              d={linePath}
              fill="none"
              stroke={CHART.series}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {hover !== null && (
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={pad.top}
                y2={pad.top + plotH}
                stroke={CHART.axis}
                strokeWidth="1"
              />
            )}

            {points.map((d, i) => (
              <circle
                key={d.id}
                cx={x(i)}
                cy={y(d.risk)}
                r={hover === i ? 5 : 3.5}
                fill={d.flagged ? "var(--app-urgent)" : CHART.series}
                stroke="var(--app-panel)"
                strokeWidth="2"
              />
            ))}

            {points.map((d, i) => {
              const show =
                i === 0 ||
                i === points.length - 1 ||
                (points.length > 4 && i === Math.floor((points.length - 1) / 2));
              if (!show) return null;
              return (
                <text
                  key={d.id}
                  x={x(i)}
                  y={height - 8}
                  textAnchor={
                    i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"
                  }
                  className="fill-[var(--app-ink-3)] text-[11px]"
                >
                  {formatShortDate(d.date)}
                </text>
              );
            })}

            {points.map((d, i) => (
              <rect
                key={d.id}
                x={x(i) - plotW / points.length / 2}
                y={pad.top}
                width={plotW / points.length}
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
            <p className="mt-0.5 text-ink-2 tabular-nums">
              {formatRisk(active.risk)} risk
            </p>
            <p className="mt-0.5 text-ink-3">
              {active.flagged ? "Flagged" : "Not flagged"}
            </p>
          </div>
        )}
        </div>
      </div>
    </section>
  );
}
