import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  CheckCheck,
  LogIn,
  PencilLine,
  ScanEye,
  ScanLine,
  Share2,
  Stethoscope,
  Trash2,
  UserMinus,
  UserPlus,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import AppPage from "@/components/app/AppPage";
import SortHeader, { PlainHeader } from "@/components/app/SortHeader";
import {
  Band,
  Button,
  EmptyState,
  ErrorBand,
  Loading,
  SearchInput,
} from "@/components/ui";
import {
  ACTIVITY_FILTERS,
  activityHref,
  activityWhen,
  getActivity,
  matchesFilter,
  splitSubject,
  type ActivityAction,
  type ActivityEntry,
  type ActivityFilter,
} from "@/lib/activity";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useTitle } from "@/hooks/useTitle";

type SortField = "at" | "action" | "subjectLabel";

/**
 * How each act reads, and what it is drawn with.
 *
 * Titled by what the doctor did, in their own words — "Recorded your
 * conclusion", not "detection updated". This list is read by the person who
 * wrote it, and a line named after the route it came from tells them nothing.
 *
 * Only deletions are coloured. They are the one act that cannot be undone, and
 * a list where every line is coloured is a list nobody reads.
 */
const SHAPE: Record<
  ActivityAction,
  { title: string; Icon: LucideIcon; grave?: boolean }
> = {
  "patient.created": { title: "Added a patient", Icon: UserPlus },
  "patient.updated": { title: "Edited a patient", Icon: PencilLine },
  "patient.deleted": { title: "Deleted a patient", Icon: UserMinus, grave: true },
  "screening.created": { title: "Recorded a screening", Icon: ScanLine },
  "screening.updated": { title: "Edited a screening", Icon: PencilLine },
  "screening.deleted": { title: "Deleted a screening", Icon: Trash2, grave: true },
  "severity.started": { title: "Started the vessel analysis", Icon: ScanEye },
  "severity.completed": { title: "Vessel analysis finished", Icon: ScanEye },
  "examiner.recorded": { title: "Recorded your own findings", Icon: Stethoscope },
  "conclusion.recorded": { title: "Recorded your conclusion", Icon: CheckCheck },
  "report.exported": { title: "Exported a report", Icon: Share2 },
  "session.opened": { title: "Signed in", Icon: LogIn },
};

const FALLBACK = { title: "Activity", Icon: PencilLine, grave: false };

/** The same horizontal rhythm the screenings and patients lists use. */
const CELL_X = "px-5 first:pl-1";

/**
 * Everything you have done, newest first.
 *
 * The record already knew what every patient and screening looks like now.
 * What it could not say was who changed it, when, or what it said before — so
 * a conclusion that had been revised looked exactly like one entered once, and
 * there was no way to answer "when did I last touch this baby" without opening
 * every record.
 *
 * Nothing on this screen edits a line, and there is no route that would. The
 * rows are written as they happen and then left alone: a history that can be
 * tidied up is not a history.
 */
export default function ActivityIndex() {
  useTitle("Activity");

  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ActivityFilter>("All");
  const [sortField, setSortField] = useState<SortField>("at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [reloads, setReloads] = useState(0);

  // Loading and the error are cleared by whoever asks for a reload, not at the
  // top of this effect: setting state there makes React render twice per fetch.
  useEffect(() => {
    let cancelled = false;

    getActivity()
      .then((rows) => {
        if (!cancelled) setEntries(rows);
      })
      .catch((cause) => {
        // An empty list and a failed load must never look the same. One says
        // you have done nothing; the other says we do not know.
        if (!cancelled)
          setError(errorMessage(cause, "Your activity could not be loaded."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reloads]);

  const counts = useMemo(() => {
    const tally: Record<string, number> = {};
    for (const option of ACTIVITY_FILTERS) {
      tally[option.key] = entries.filter((entry) =>
        matchesFilter(entry, option.key),
      ).length;
    }
    return tally;
  }, [entries]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();

    return entries
      .filter((entry) => {
        if (!matchesFilter(entry, filter)) return false;
        if (!query) return true;
        return [
          entry.subjectLabel,
          entry.detail,
          entry.subjectId,
          SHAPE[entry.action]?.title,
        ]
          .filter(Boolean)
          .some((field) => String(field).toLowerCase().includes(query));
      })
      .sort((a, b) => {
        const compared =
          sortField === "action"
            ? (SHAPE[a.action]?.title ?? "").localeCompare(
                SHAPE[b.action]?.title ?? "",
              )
            : String(a[sortField] ?? "").localeCompare(
                String(b[sortField] ?? ""),
              );
        return sortDir === "asc" ? compared : -compared;
      });
  }, [entries, search, filter, sortField, sortDir]);

  function handleSort(field: SortField) {
    if (field === sortField) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
      return;
    }
    setSortField(field);
    // Newest first, but names read better the other way round.
    setSortDir(field === "at" ? "desc" : "asc");
  }

  return (
    <AppPage>
      <div className="p-6 md:p-10">
        <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
          <div>
            <h1 className="font-heading text-display text-ink">Activity</h1>
          </div>
        </header>

        {error && (
          <div className="mt-6">
            <ErrorBand
              message={error}
              onRetry={() => {
                setLoading(true);
                setError("");
                setReloads((n) => n + 1);
              }}
            />
          </div>
        )}

        <Band className="mt-8">
          <div className="flex flex-wrap items-center gap-3">
            <SearchInput
              label="Search your activity"
              placeholder="Patient, record number or action"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full sm:max-w-xs"
            />

            <div className="flex flex-wrap gap-1.5">
              {ACTIVITY_FILTERS.map((option) => {
                const active = filter === option.key;
                return (
                  <button
                    key={option.key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setFilter(option.key)}
                    className={cn(
                      "cursor-pointer rounded-lg border px-3 py-1.5 text-label font-medium transition-colors",
                      active
                        ? "border-[var(--app-primary-line)] bg-[var(--app-primary-bg)] text-[var(--app-primary-ink)]"
                        : "border-line bg-panel text-ink-2 hover:bg-inset hover:text-ink",
                    )}
                  >
                    {option.label}
                    <span className="ml-1.5 tabular-nums opacity-70">
                      {counts[option.key] ?? 0}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[58rem] border-collapse">
              <thead>
                <tr className="border-b border-line">
                  <SortHeader
                    label="Action"
                    field="action"
                    sortField={sortField}
                    sortDir={sortDir}
                    onSort={handleSort}
                    className={cn(CELL_X, "w-[24%] whitespace-nowrap")}
                  />
                  <SortHeader
                    label="Record"
                    field="subjectLabel"
                    sortField={sortField}
                    sortDir={sortDir}
                    onSort={handleSort}
                    className={cn(CELL_X, "w-[24%] whitespace-nowrap")}
                  />
                  <PlainHeader className={CELL_X}>What changed</PlainHeader>
                  <SortHeader
                    label="When"
                    field="at"
                    sortField={sortField}
                    sortDir={sortDir}
                    onSort={handleSort}
                    align="right"
                    className="whitespace-nowrap px-2"
                  />
                </tr>
              </thead>

              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={4}>
                      <Loading label="Loading your activity…" />
                    </td>
                  </tr>
                )}

                {!loading && visible.length === 0 && (
                  <tr>
                    <td colSpan={4}>
                      <EmptyState
                        title={
                          entries.length === 0
                            ? "Nothing here yet"
                            : "No activity matches"
                        }
                        hint={
                          entries.length === 0
                            ? "Add a patient or record a screening, and it will appear here."
                            : "Try a different search, or clear the filter."
                        }
                        action={
                          entries.length > 0 && (
                            <Button
                              size="sm"
                              onClick={() => {
                                setSearch("");
                                setFilter("All");
                              }}
                            >
                              Clear the filter
                            </Button>
                          )
                        }
                      />
                    </td>
                  </tr>
                )}

                {!loading &&
                  visible.map((entry) => {
                    const shape = SHAPE[entry.action] ?? FALLBACK;
                    const href = activityHref(entry);
                    const subject = splitSubject(entry.subjectLabel);
                    const when = activityWhen(entry.at);

                    return (
                      <tr
                        key={entry.id}
                        className="border-b border-line-soft transition-colors last:border-0 hover:bg-inset/60"
                      >
                        <td className={cn(CELL_X, "py-3.5")}>
                          <span className="flex items-center gap-2.5">
                            <span
                              className={cn(
                                "flex size-7 shrink-0 items-center justify-center rounded-full border",
                                shape.grave
                                  ? "border-urgent-line bg-urgent-wash text-urgent"
                                  : "border-line bg-inset text-ink-3",
                              )}
                            >
                              <shape.Icon className="size-3.5" aria-hidden />
                            </span>
                            <span className="text-body text-ink">{shape.title}</span>
                          </span>
                        </td>

                        <td className={cn(CELL_X, "py-3.5")}>
                          {/* A deleted record has nowhere to go, so its line is
                              not a link. It still names what it was — that is
                              the part this list exists to keep. */}
                          {!subject.name ? (
                            <span className="text-body text-ink-3">—</span>
                          ) : href ? (
                            <Link to={href} className="group block">
                              <span className="block text-body font-medium text-ink underline-offset-4 group-hover:underline">
                                {subject.name}
                              </span>
                              <span className="mt-0.5 block text-micro tabular-nums text-ink-3">
                                {subject.qualifier || entry.subjectId}
                              </span>
                            </Link>
                          ) : (
                            <span className="block">
                              <span className="block text-body font-medium text-ink-2">
                                {subject.name}
                              </span>
                              <span className="mt-0.5 block text-micro tabular-nums text-ink-3">
                                {subject.qualifier || entry.subjectId}
                              </span>
                            </span>
                          )}
                        </td>

                        <td
                          className={cn(
                            CELL_X,
                            "py-3.5 text-body leading-relaxed text-ink-2",
                          )}
                        >
                          {entry.detail || "—"}
                        </td>

                        <td className="px-2 py-3.5 text-right">
                          <time
                            dateTime={entry.at}
                            className="block whitespace-nowrap text-body tabular-nums text-ink-2"
                          >
                            {when.date}
                          </time>
                          <span className="mt-0.5 block text-micro tabular-nums text-ink-3">
                            {when.time}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </Band>
      </div>
    </AppPage>
  );
}
