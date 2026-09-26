import { apiGet } from "./api";

/**
 * What the doctor did, as the gateway recorded it.
 *
 * Read only. There is no route that writes here from the app, and none that
 * returns anyone else's — the server scopes every row to the signed-in
 * doctor, the same way it scopes patients and screenings.
 */

export const ACTIVITY_ACTIONS = [
  "patient.created",
  "patient.updated",
  "patient.deleted",
  "screening.created",
  "screening.updated",
  "screening.deleted",
  "severity.started",
  "severity.completed",
  "examiner.recorded",
  "conclusion.recorded",
  "report.exported",
  "session.opened",
] as const;

export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

export interface ActivityEntry {
  id: string;
  action: ActivityAction;
  subjectType: "patient" | "screening" | "session";
  subjectId: string | null;
  /** How the subject read at the time — kept even after it is deleted. */
  subjectLabel: string | null;
  detail: string | null;
  at: string;
}

export async function getActivity(limit = 80): Promise<ActivityEntry[]> {
  return apiGet<ActivityEntry[]>(`/activity?limit=${limit}`);
}

/**
 * Where a row points.
 *
 * Nowhere, for anything deleted: a link to a record that no longer exists is
 * worse than no link. The line still names what it was, which is the part
 * that has to survive.
 */
export function activityHref(entry: ActivityEntry): string | null {
  if (!entry.subjectId) return null;
  if (entry.action.endsWith(".deleted")) return null;
  if (entry.subjectType === "patient") return `/app/patient/${entry.subjectId}`;
  if (entry.subjectType === "screening")
    return `/app/detection/${entry.subjectId}`;
  return null;
}

/**
 * The subject, split for a two-line table cell.
 *
 * A screening is recorded as "Mehdi Bouazizi — 2026-09-20": the name is what
 * the eye looks for, the date is what tells two screenings of the same baby
 * apart. The name goes on the first line, the rest under it beside the record
 * number, the way the screenings list already prints a patient.
 */
export function splitSubject(label: string | null): {
  name: string;
  qualifier: string;
} {
  if (!label) return { name: "", qualifier: "" };
  const at = label.indexOf(" — ");
  if (at === -1) return { name: label, qualifier: "" };
  return { name: label.slice(0, at), qualifier: label.slice(at + 3) };
}

/** When it happened, as one line: the date, then the time. */
export function activityWhen(at: string): { date: string; time: string } {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return { date: at, time: "" };
  return {
    date: date.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }),
    time: date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
  };
}

/**
 * The groups the filter chips offer.
 *
 * By the thing acted on rather than by the verb: a doctor looking for when
 * they last touched a baby's record wants the patient's line and the
 * screening's line together, not "everything I deleted".
 */
export const ACTIVITY_FILTERS = [
  { key: "All", label: "All" },
  { key: "Patients", label: "Patients" },
  { key: "Screenings", label: "Screenings" },
  { key: "Analysis", label: "Vessel analysis" },
  { key: "Conclusions", label: "Your findings" },
] as const;

export type ActivityFilter = (typeof ACTIVITY_FILTERS)[number]["key"];

export function matchesFilter(
  entry: ActivityEntry,
  filter: ActivityFilter,
): boolean {
  if (filter === "All") return true;
  if (filter === "Patients") return entry.action.startsWith("patient.");
  if (filter === "Screenings") return entry.action.startsWith("screening.");
  if (filter === "Analysis") return entry.action.startsWith("severity.");
  return (
    entry.action === "examiner.recorded" ||
    entry.action === "conclusion.recorded" ||
    entry.action === "report.exported"
  );
}
