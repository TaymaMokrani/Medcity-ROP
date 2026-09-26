import { Loader2 } from "lucide-react";

/**
 * What the analyser is doing right now.
 *
 * A minute is long enough that a spinner alone would read as a hang, so the
 * step text is the real one the pipeline reports — which photograph of which
 * eye it is on — and the count says how far through it is.
 *
 * It used to be a half-pixel rule in the page's own grey, which on a white
 * screen is not a loader so much as a rumour of one. A minute of waiting
 * deserves a panel that is obviously running: a moving spinner, a bar thick
 * enough to see from a metre away, and the share left to go.
 */
export default function SeverityProgress({
  step,
  progress,
  seconds,
}: {
  step: string | null;
  progress: { done: number; total: number } | null;
  seconds: number | null;
}) {
  const done = progress?.done ?? 0;
  const total = progress?.total ?? 0;
  // Never zero: a bar with nothing in it looks like a bar that is stuck.
  const percent = total ? Math.min(100, Math.round((done / total) * 100)) : 6;

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-panel">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
        <Loader2
          className="size-5 shrink-0 animate-spin text-accent"
          strokeWidth={2}
          aria-hidden
        />
        <p className="min-w-0 flex-1 text-lead text-ink first-letter:uppercase">
          {step ?? "Starting the analysis"}
        </p>
        {total > 0 && (
          <span className="shrink-0 font-heading text-title tabular-nums text-ink">
            {percent}%
          </span>
        )}
      </div>

      <div
        className="h-2 bg-inset"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Severity analysis"
      >
        <div
          className="h-full bg-accent transition-all duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>

      <p className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 py-3 text-label text-ink-3">
        <span>
          Measuring vessels at full resolution — about five seconds a
          photograph.
        </span>
        {seconds ? (
          <span className="shrink-0 tabular-nums">{Math.round(seconds)}s</span>
        ) : null}
      </p>
    </div>
  );
}
