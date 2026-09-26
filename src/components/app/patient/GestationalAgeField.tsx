import { useId } from "react";
import { InlineError } from "@/components/ui";
import { GESTATIONAL_AGE, joinWeeks, splitWeeks } from "@/lib/validation";
import { cn } from "@/lib/utils";

/**
 * Gestational age at birth, entered as weeks and days.
 *
 * The record holds one number in weeks, because that is what the model is fed.
 * But a unit writes "27+4", and a field that only took whole weeks quietly
 * dropped four days of it — which matters when the difference between 27+0 and
 * 27+6 is a week of retinal development.
 *
 * Days are 0 to 6. Seven days is the next week, and the helper rolls it over
 * rather than storing a number that would read as 27+7.
 */
export default function GestationalAgeField({
  value,
  onChange,
  error,
  required = true,
}: {
  /** Weeks, possibly fractional, as the form holds it. */
  value: string;
  onChange: (weeks: string) => void;
  error?: string;
  required?: boolean;
}) {
  const id = useId();
  const { weeks, days } = splitWeeks(value);

  const box = cn(
    "h-9 w-full rounded-lg border bg-[var(--app-field-bg)] px-3 text-body text-ink tabular-nums",
    error ? "border-urgent-line" : "border-line hover:border-ink-3/50",
  );

  return (
    <div>
      <label htmlFor={`${id}-weeks`} className="mb-1.5 block text-label font-medium text-ink-2">
        Gestational age at birth
        {required && (
          <span className="ml-1 text-urgent" aria-hidden>
            *
          </span>
        )}
      </label>

      <div className="flex items-center gap-2">
        <div className="flex items-baseline gap-1.5">
          <input
            id={`${id}-weeks`}
            type="number"
            inputMode="numeric"
            placeholder="27"
            aria-label="Gestational age, weeks"
            min={GESTATIONAL_AGE.min}
            max={GESTATIONAL_AGE.max}
            value={weeks}
            onChange={(event) => onChange(joinWeeks(event.target.value, days))}
            className={cn(box, "w-20")}
          />
          <span className="text-label text-ink-3">weeks</span>
        </div>

        <span className="text-body text-ink-3" aria-hidden>
          +
        </span>

        <div className="flex items-baseline gap-1.5">
          <input
            id={`${id}-days`}
            type="number"
            inputMode="numeric"
            placeholder="0"
            aria-label="Gestational age, days"
            min={0}
            max={6}
            value={days}
            onChange={(event) => onChange(joinWeeks(weeks, event.target.value))}
            className={cn(box, "w-16")}
          />
          <span className="text-label text-ink-3">days</span>
        </div>
      </div>

      <p className="mt-1 text-micro text-ink-3">
        {GESTATIONAL_AGE.min}–{GESTATIONAL_AGE.max} weeks · read by the model
      </p>
      {error && <InlineError>{error}</InlineError>}
    </div>
  );
}
