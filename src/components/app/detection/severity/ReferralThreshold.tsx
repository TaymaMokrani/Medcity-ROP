import type { CSSProperties } from "react";
import { formatRisk } from "@/lib/detections";

/** Only what this reads. A pre-save estimate has no stored images to name. */
interface EyeRisk {
  eye: string;
  risk: number;
}

/**
 * Which eyes get measured, as a share of the Phase 1 risk.
 *
 * The line decides the work: an eye under it is left alone, an eye at or above
 * it is analysed. Moving the slider down brings a quieter eye back in, which is
 * the whole reason the control is here rather than fixed in the code.
 *
 * The rule reads above the slider and the eyes read below it, in that order,
 * because that is the order of the question: this is what the line does, this
 * is where you have put it, this is what falls either side. All three used to
 * run together under the track, so the sentence explaining the control arrived
 * after the answer it explained.
 */
export default function ReferralThreshold({
  threshold,
  onChange,
  eyeResults,
}: {
  threshold: number;
  onChange: (value: number) => void;
  eyeResults: EyeRisk[];
}) {
  const percent = Math.round(threshold * 100);
  // Track fill, in the slider's own 5–95 range rather than 0–100.
  const fill = ((percent - 5) / 90) * 100;
  const above = eyeResults.filter((eye) => eye.risk >= threshold);

  return (
    <div className="max-w-lg rounded-xl border border-line bg-panel p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-body text-ink">Referral threshold</p>
        <p className="font-heading text-title tabular-nums text-ink">{percent}%</p>
      </div>

      <p className="mt-1 text-label leading-relaxed text-ink-3">
        {above.length === 0
          ? "No eye reaches the line — lower it to measure one."
          : `Eyes at or above ${percent}% risk are measured.`}
      </p>

      <label className="mt-4 flex items-center">
        <span className="sr-only">Referral threshold</span>
        <input
          type="range"
          min={5}
          max={95}
          step={5}
          value={percent}
          onChange={(event) => onChange(Number(event.target.value) / 100)}
          style={{ "--rop-slider-fill": `${fill}%` } as CSSProperties}
          className="rop-slider"
        />
      </label>

      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 border-t border-line-soft pt-3">
        {eyeResults.map((eye) => {
          const included = eye.risk >= threshold;
          return (
            <div key={eye.eye} className="flex items-baseline gap-2">
              <dt className="text-label text-ink-3">{eye.eye}</dt>
              <dd
                className={`text-label tabular-nums ${
                  included ? "text-ink" : "text-ink-3"
                }`}
              >
                {formatRisk(eye.risk)}
                <span className="ml-1.5 text-ink-3">
                  {included ? "analysed" : "skipped"}
                </span>
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
