import { Link } from "react-router-dom";
import { DOCTOR_DECISIONS, type DoctorDecision } from "@/lib/detections";
import { CHART } from "./tokens";

/**
 * What the screenings on record came to.
 *
 * This band used to be a risk donut cut at 20% and 50%, with a screening
 * interval printed beside each slice — "Immediate check", "Weekly screening".
 * Nothing in the system decided those tiers or those intervals. They were
 * written here, and they read like a recommendation.
 *
 * It is a donut again, but of a different thing: how many screenings ended in
 * each conclusion, and how many are still open. Every number is a thing a
 * person did, and each one is a link to the list filtered to it.
 */

const COLOUR: Record<DoctorDecision, string> = {
    "Confirms ROP": "var(--app-urgent)",
    Uncertain: "var(--app-watch)",
    "No ROP": "var(--app-steady)",
    Pending: CHART.series,
};

const ORDER: DoctorDecision[] = ["Confirms ROP", "Uncertain", "No ROP", "Pending"];

const LABEL: Partial<Record<DoctorDecision, string>> = {
    Pending: "Awaiting your conclusion",
};

const SIZE = 128;
const STROKE = 17;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const GAP = 3;

export function Decisions({
    detections,
}: {
    detections: { doctorDecision?: DoctorDecision }[];
}) {
    const counts = new Map<DoctorDecision, number>(
        DOCTOR_DECISIONS.map((decision) => [decision, 0]),
    );
    for (const detection of detections) {
        const key = detection.doctorDecision ?? "Pending";
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const total = detections.length;
    if (total === 0) {
        return <p className="py-6 text-body text-ink-3">No screenings on record yet.</p>;
    }

    const rows = ORDER.map((decision) => ({
        decision,
        count: counts.get(decision) ?? 0,
        colour: COLOUR[decision],
    }));

    // Each slice is an arc of the same circle, offset by everything before it.
    const slices = rows
        .filter((row) => row.count > 0)
        .reduce<{ decision: DoctorDecision; count: number; colour: string; length: number; offset: number }[]>(
            (drawn, row) => {
                const offset = drawn.reduce((sum, slice) => sum + slice.length, 0);
                const length = (row.count / total) * CIRCUMFERENCE;
                return [...drawn, { ...row, length, offset }];
            },
            [],
        );
    const single = slices.length === 1;

    return (
        <div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-5">
                <svg
                    width={SIZE}
                    height={SIZE}
                    role="img"
                    aria-label={rows
                        .filter((r) => r.count)
                        .map((r) => `${LABEL[r.decision] ?? r.decision}: ${r.count}`)
                        .join(", ")}
                >
                    <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
                        <circle
                            cx={SIZE / 2}
                            cy={SIZE / 2}
                            r={RADIUS}
                            fill="none"
                            stroke={CHART.grid}
                            strokeWidth={STROKE}
                        />
                        {slices.map((slice) => (
                            <circle
                                key={slice.decision}
                                cx={SIZE / 2}
                                cy={SIZE / 2}
                                r={RADIUS}
                                fill="none"
                                stroke={slice.colour}
                                strokeWidth={STROKE}
                                strokeDasharray={
                                    single
                                        ? `${CIRCUMFERENCE} 0`
                                        : `${Math.max(slice.length - GAP, 1)} ${CIRCUMFERENCE}`
                                }
                                strokeDashoffset={-slice.offset}
                                strokeLinecap="butt"
                            />
                        ))}
                    </g>
                    <text
                        x={SIZE / 2}
                        y={SIZE / 2 - 2}
                        textAnchor="middle"
                        className="fill-[var(--app-ink)] font-heading text-[22px] [font-variant-numeric:tabular-nums]"
                    >
                        {total}
                    </text>
                    <text
                        x={SIZE / 2}
                        y={SIZE / 2 + 16}
                        textAnchor="middle"
                        className="fill-[var(--app-ink-3)] text-[11px]"
                    >
                        screenings
                    </text>
                </svg>

            <dl className="min-w-[9.5rem] flex-1 divide-y divide-line-soft border-y border-line-soft">
                {rows.map((row) => (
                    <div
                        key={row.decision}
                        className="flex items-baseline justify-between gap-4 py-2"
                    >
                        <dt className="flex min-w-0 items-baseline gap-2.5">
                            <span
                                className="size-2 shrink-0 translate-y-[-1px] rounded-full"
                                style={{ background: row.colour }}
                            />
                            <Link
                                to={`/app/detection?decision=${encodeURIComponent(row.decision)}`}
                                className="truncate text-body text-ink-2 transition-colors hover:text-ink"
                            >
                                {LABEL[row.decision] ?? row.decision}
                            </Link>
                        </dt>
                        <dd className="shrink-0 text-body text-ink tabular-nums">{row.count}</dd>
                    </div>
                ))}
                </dl>
            </div>
        </div>
    );
}
