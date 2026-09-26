/**
 * What counts as a usable clinical value.
 *
 * Gestational age and birth weight are not ordinary form fields: they are fed
 * to the screening model, and the model answers whatever it is asked. A weight
 * typed as 100 instead of 1000 comes back as a risk that looks exactly like a
 * real one. So the same limits are stated once here, applied in every form that
 * can write them, and repeated in the gateway's DTO — because a rule that lives
 * only in the browser is not a rule.
 */

export const GESTATIONAL_AGE = { min: 20, max: 42, unit: "weeks" } as const;
export const BIRTH_WEIGHT = { min: 300, max: 5000, unit: "g" } as const;

export type Errors = Record<string, string>;

export function required(value: string | undefined | null, field: string): string | null {
  return value && value.trim() ? null : `${field} is required`;
}

export function inRange(
  value: number | undefined | null,
  range: { min: number; max: number; unit: string },
  field: string,
): string | null {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return `${field} is required`;
  }
  if (value < range.min || value > range.max) {
    return `${field} must be between ${range.min} and ${range.max} ${range.unit}`;
  }
  return null;
}

/** A birth date cannot be in the future, and a newborn cannot be years old. */
export function birthDate(value: string): string | null {
  if (!value) return "Date of birth is required";
  const born = new Date(value);
  if (Number.isNaN(born.getTime())) return "That is not a date";
  if (born.getTime() > Date.now()) return "That date is in the future";
  return null;
}

export interface ClinicalFields {
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  gestationalAge?: number;
  birthWeight?: number;
}

/**
 * The checks every patient form runs, wherever it lives — the full form, the
 * quick one during a screening, and the edit fields on the record. The record
 * used to skip them entirely, so a saved patient could be edited into a
 * gestational age of 0.
 */
export function validatePatient(form: ClinicalFields): Errors {
  const found: Errors = {};

  const first = required(form.firstName, "First name");
  if (first) found.firstName = first;

  const last = required(form.lastName, "Last name");
  if (last) found.lastName = last;

  const dob = birthDate(form.dateOfBirth ?? "");
  if (dob) found.dateOfBirth = dob;

  const ga = inRange(form.gestationalAge, GESTATIONAL_AGE, "Gestational age");
  if (ga) found.gestationalAge = ga;

  const weight = inRange(form.birthWeight, BIRTH_WEIGHT, "Birth weight");
  if (weight) found.birthWeight = weight;

  return found;
}

export function isValid(errors: Errors): boolean {
  return Object.keys(errors).length === 0;
}

/* ---------------------------------------------------------------------------
 * Gestational age, the way it is spoken
 *
 * A neonatologist does not say "27.57 weeks", they say "27 plus 4" — 27 weeks
 * and 4 days. The number is stored as weeks, because that is what the model is
 * fed and what the column holds, but nobody should have to divide by seven to
 * enter it.
 * ------------------------------------------------------------------------ */

export function splitWeeks(value: number | string | undefined | null): {
  weeks: string;
  days: string;
} {
  const total = Number(value);
  if (value === "" || value === null || value === undefined || !Number.isFinite(total)) {
    return { weeks: "", days: "" };
  }
  const weeks = Math.floor(total);
  // 27.571428… came from 27 weeks and 4 days; rounding brings the 4 back.
  const days = Math.round((total - weeks) * 7);
  return days === 7
    ? { weeks: String(weeks + 1), days: "0" }
    : { weeks: String(weeks), days: String(days) };
}

export function joinWeeks(weeks: string, days: string): string {
  if (weeks === "") return "";
  const w = Number(weeks);
  const d = days === "" ? 0 : Number(days);
  if (!Number.isFinite(w) || !Number.isFinite(d)) return "";
  return String(w + d / 7);
}

/** "27+4", or an empty string when nothing has been entered. */
export function formatWeeks(value: number | string | undefined | null): string {
  const { weeks, days } = splitWeeks(value);
  return weeks === "" ? "" : `${weeks}+${days}`;
}
