export function formatDate(value: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatShortDate(value: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

/**
 * Today, where the user is.
 *
 * `toISOString` is UTC. In Tunisia that made every screening recorded between
 * midnight and 1 a.m. carry yesterday's date.
 */
export function today(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().split("T")[0];
}

export function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

/**
 * Postmenstrual age: how far along the baby would be if still in the womb.
 *
 * It is the gestational age at birth plus the time since, and it is the clock
 * ROP runs on — screening starts at about 31 weeks PMA, and treatment decisions
 * are made against it. Chronological age alone does not say that: a baby born
 * at 25 weeks and one born at 32 weeks are at very different points on the same
 * birthday.
 *
 * Written the way it is spoken: 32 weeks and 2 days is "32+2".
 *
 * A baby born at 27 weeks, now 37 days old, is 27 × 7 + 37 = 226 days, which is
 * 32 weeks and 2 days — so "32+2".
 */
export function formatPma(dateOfBirth: string, gestationalAgeWeeks: number): string {
  const days = pmaDays(dateOfBirth, gestationalAgeWeeks);
  if (days === null) return "—";
  return `${Math.floor(days / 7)}+${days % 7}`;
}

export function pmaDays(
  dateOfBirth: string,
  gestationalAgeWeeks: number,
): number | null {
  const born = new Date(dateOfBirth);
  if (!dateOfBirth || Number.isNaN(born.getTime())) return null;
  if (!Number.isFinite(gestationalAgeWeeks)) return null;
  return Math.round(gestationalAgeWeeks * 7) + daysOfLife(dateOfBirth);
}

/** Days since birth. Never negative, so a mistyped future date reads as 0. */
export function daysOfLife(dateOfBirth: string): number {
  const born = new Date(dateOfBirth);
  if (!dateOfBirth || Number.isNaN(born.getTime())) return 0;
  const days = Math.floor((Date.now() - born.getTime()) / 86_400_000);
  return Math.max(0, days);
}

export function formatAge(dateOfBirth: string): string {
  const days = Math.floor(
    (Date.now() - new Date(dateOfBirth).getTime()) / (1000 * 60 * 60 * 24)
  );
  if (days < 30) return `${days} days`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months > 1 ? "s" : ""}`;

  const years = Math.floor(months / 12);
  return `${years} year${years > 1 ? "s" : ""}`;
}
