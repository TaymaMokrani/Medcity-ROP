import { CHART } from "./tokens";

/**
 * Flag rate by gestational age.
 *
 * Two things were wrong here. The legend said "ROP detected" and "No ROP",
 * which a screening flag is not — and "No ROP" was counting babies who had
 * never been screened at all. And the heading printed "flag rate rises as
 * gestational age falls" whatever the bars underneath actually showed.
 *
 * Now the bar is the flagged share of the babies in that band who have been
 * screened, the unscreened are counted separately rather than folded in as
 * negatives, and nothing here claims to know what the shape means.
 */
export interface Band {
    label: string;
    screened: number;
    flagged: number;
    unscreened: number;
}

export function GestationalBands({ data }: { data: Band[] }) {
    const max = Math.max(...data.map((d) => d.screened), 1);
    const anyUnscreened = data.some((d) => d.unscreened > 0);

    return (
        <div>
            <div className="flex flex-col gap-3">
                {data.map(({ label, screened, flagged, unscreened }) => {
                    const barWidth = (screened / max) * 100;
                    const flaggedShare = screened > 0 ? (flagged / screened) * 100 : 0;
                    return (
                        <div key={label} className="flex items-center gap-3">
                            <span className="w-14 shrink-0 text-label text-ink-3">
                                {label}
                            </span>
                            <div className="h-3.5 flex-1 rounded-sm bg-inset">
                                <div
                                    className="flex h-3.5 gap-[2px] overflow-hidden rounded-r-[3px]"
                                    style={{ width: `${barWidth}%` }}
                                >
                                    {flagged > 0 && (
                                        <span
                                            className="h-full shrink-0"
                                            style={{
                                                width: `${flaggedShare}%`,
                                                backgroundColor: CHART.series,
                                            }}
                                        />
                                    )}
                                    {flagged < screened && (
                                        <span
                                            className="h-full flex-1 rounded-r-[4px]"
                                            style={{ backgroundColor: CHART.muted }}
                                        />
                                    )}
                                </div>
                            </div>
                            <span className="w-14 shrink-0 text-right text-body text-ink tabular-nums">
                                {flagged}/{screened}
                            </span>
                            <span className="w-20 shrink-0 text-right text-micro text-ink-3 tabular-nums">
                                {unscreened > 0 ? `${unscreened} unscreened` : ""}
                            </span>
                        </div>
                    );
                })}
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-4 border-t border-line-soft pt-3">
                <span className="flex items-center gap-2 text-label text-ink-3">
                    <span
                        className="size-2 rounded-full"
                        style={{ backgroundColor: CHART.series }}
                    />
                    Flagged
                </span>
                <span className="flex items-center gap-2 text-label text-ink-3">
                    <span
                        className="size-2 rounded-full"
                        style={{ backgroundColor: CHART.muted }}
                    />
                    Not flagged
                </span>
                {anyUnscreened && (
                    <span className="text-micro text-ink-3">
                        Babies with no screening on record are counted apart, not as
                        clear.
                    </span>
                )}
            </div>
        </div>
    );
}
