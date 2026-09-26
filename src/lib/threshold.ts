/**
 * The two lines, kept apart.
 *
 * The app used to have four numbers that all read like "the risky line": the
 * colour ramp's bend at 25%, the dashboard's 20/50 tiers, the referral slider
 * at 40%, and the model's own cut-off. One eye at 30% could be amber, moderate,
 * skipped and flagged at the same time. Only two of those are real.
 *
 *  1. The MODEL LINE decides `flagged`. The model draws it and reports it with
 *     every prediction, and it is the only line that says anything about the
 *     eye. Nothing here computes it, and nothing here prints it any more: the
 *     figure was the same on every eye of every screening, so the interface
 *     shows the verdict and leaves the arithmetic behind it alone.
 *
 *  2. The MEASURE LINE is the doctor's own preference for which eyes are worth
 *     sending to the severity analysis. It is about workload, not disease. It
 *     never decides anything clinical and never blocks the button.
 *
 * The dashboard's tiers are gone. They were invented here.
 */

/* ---------------------------------------------------------------- model line */

/** Colour belongs above the line. Below it, a number is just a number. */
export function colourByFlag(flagged: boolean): boolean {
  return flagged;
}

/* -------------------------------------------------------------- measure line */

/**
 * Which eyes the interface suggests measuring, as a share of the Phase 1 risk.
 *
 * A preference, not a rule. The severity button is offered on every eye, and an
 * eye under the line can always be analysed: a cut-off that refused would turn
 * one doctor's setting into a clinical decision, and this one is not even
 * shared — it lives in this browser.
 */
export const DEFAULT_MEASURE_LINE = 0.4;
const MEASURE_LINE_KEY = "medcity.measureLine";

export function readMeasureLine(): number {
  try {
    const stored = Number(localStorage.getItem(MEASURE_LINE_KEY));
    if (Number.isFinite(stored) && stored > 0 && stored <= 1) return stored;
  } catch {
    // private window, or storage blocked — the default is fine
  }
  return DEFAULT_MEASURE_LINE;
}

export function writeMeasureLine(value: number): void {
  try {
    localStorage.setItem(MEASURE_LINE_KEY, String(value));
  } catch {
    // the preference simply does not persist
  }
}

/** The eyes at or above the line: a suggestion for the analysis, nothing more. */
export function suggestedEyes<T extends { eye: string; risk: number }>(
  results: T[],
  line: number,
): T[] {
  return results.filter((result) => result.risk >= line);
}
