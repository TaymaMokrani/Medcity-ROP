import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";
import AppPage from "@/components/app/AppPage";
import SortHeader, { PlainHeader } from "@/components/app/SortHeader";
import RiskBar from "@/components/app/RiskBar";
import {
  Band,
  Button,
  Chip,
  EmptyState,
  ErrorBand,
  IconButton,
  Loading,
  SearchInput,
} from "@/components/ui";
import {
  getDetections,
  deleteDetection,
  riskPercent,
  formatRisk,
  type Detection,
} from "@/lib/detections";
import { stateTone, verdictFor } from "@/lib/screening";
import { errorMessage } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useTitle } from "@/hooks/useTitle";

type SortField = "date" | "patientName" | "risk" | "doctorDecision";

/**
 * Which screenings this list is showing.
 *
 * "Awaiting your conclusion" is the one that was missing. The count sat on a
 * tile at the top of the page with no way to act on it, so the list could tell
 * you eleven screenings needed you and give you no way to see them. The tiles
 * are the filters now, and the dashboard links straight into them.
 */
const FILTERS = [
  { key: "All", label: "All" },
  { key: "Pending", label: "Awaiting your conclusion" },
  { key: "Flagged", label: "Flagged by the model" },
  { key: "Confirms ROP", label: "You confirmed ROP" },
  { key: "Disputed", label: "You and the model disagreed" },
] as const;

/**
 * One width for every chip in the two verdict columns.
 *
 * Sized to the longest label, "Not flagged", so the pills stack into two clean
 * columns instead of a ragged edge that changes shape on every row.
 */
const PILL = "w-28 justify-center";

/** The same horizontal rhythm the patients list uses. */
const CELL_X = "px-5 first:pl-1";
const CELL = `${CELL_X} py-3.5 whitespace-nowrap text-body text-ink-2 tabular-nums`;

/**
 * The conclusion, said in as few words as the column needs.
 *
 * The record keeps "Confirms ROP" and "Pending", which read as sentences about
 * a decision. In a column already headed "Your conclusion", the verb is the
 * heading's job.
 */
const SHORT_DECISION: Record<string, string> = {
  Pending: "Awaiting",
  "Confirms ROP": "ROP",
  "No ROP": "No ROP",
  Uncertain: "Uncertain",
};

export default function ScreeningsIndex() {
  useTitle("Screenings");
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [detections, setDetections] = useState<Detection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // The dashboard links here with ?decision=Pending; the filter chips keep the
  // address in step, so a filtered list can be shared or reloaded.
  const filter = params.get("decision") ?? "All";

  useEffect(() => {
    async function load() {
      try {
        setDetections(await getDetections());
      } catch (e) {
        setError(errorMessage(e, "Could not load the screenings."));
      }
      setLoading(false);
    }
    void load();
  }, []);

  const counts = useMemo(() => {
    const decided = (d: Detection) => d.doctorDecision ?? "Pending";
    return {
      All: detections.length,
      Pending: detections.filter((d) => decided(d) === "Pending").length,
      Flagged: detections.filter((d) => d.flagged).length,
      "Confirms ROP": detections.filter((d) => decided(d) === "Confirms ROP").length,
      Disputed: detections.filter((d) => verdictFor(d).disputed).length,
    } as Record<string, number>;
  }, [detections]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();

    return detections
      .filter((d) => {
        const decision = d.doctorDecision ?? "Pending";
        if (filter === "Pending" && decision !== "Pending") return false;
        if (filter === "Flagged" && !d.flagged) return false;
        if (filter === "Confirms ROP" && decision !== "Confirms ROP") return false;
        if (filter === "Disputed" && !verdictFor(d).disputed) return false;

        if (!query) return true;
        return [d.patientName, d.id, d.patientId, d.doctorDecision ?? ""]
          .filter(Boolean)
          .some((field) => field.toLowerCase().includes(query));
      })
      .sort((a, b) => {
        const compared =
          sortField === "risk"
            ? a.risk - b.risk
            : String(a[sortField]).localeCompare(String(b[sortField]));
        return sortDir === "asc" ? compared : -compared;
      });
  }, [detections, search, filter, sortField, sortDir]);

  function handleSort(field: SortField) {
    if (field === sortField) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      // Newest and riskiest first: nobody opens this list for the oldest one.
      setSortDir(field === "patientName" ? "asc" : "desc");
    }
  }

  async function handleDelete(detection: Detection) {
    const confirmed = confirm(
      `Delete the screening of ${detection.patientName} on ${formatDate(detection.date)}? This cannot be undone.`,
    );
    if (!confirmed) return;

    setError("");
    try {
      await deleteDetection(detection.id);
      setDetections((current) => current.filter((d) => d.id !== detection.id));
    } catch (e) {
      setError(errorMessage(e, "Could not delete this screening."));
    }
  }

  return (
    <AppPage>
      <div className="p-6 md:p-10">
        <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
          <div>
            <h1 className="font-heading text-display text-ink">Screenings</h1>
          </div>
          <Button
            variant="primary"
            icon={Plus}
            onClick={() => navigate("/app/detection/new")}
          >
            New screening
          </Button>
        </header>

        {error && (
          <div className="mt-6">
            <ErrorBand message={error} />
          </div>
        )}

        <Band className="mt-8">
          <div className="flex flex-wrap items-center gap-3">
            <SearchInput
              label="Search screenings"
              placeholder="Patient, record number or conclusion"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full sm:max-w-xs"
            />

            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map((option) => {
                const active = filter === option.key;
                return (
                  <button
                    key={option.key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      const next = new URLSearchParams(params);
                      if (option.key === "All") next.delete("decision");
                      else next.set("decision", option.key);
                      setParams(next, { replace: true });
                    }}
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
            <table className="w-full min-w-[62rem] border-collapse">
              <thead>
                <tr className="border-b border-line">
                  <SortHeader
                    label="Patient"
                    field="patientName"
                    sortField={sortField}
                    sortDir={sortDir}
                    onSort={handleSort}
                    className={cn(CELL_X, "w-[24%] whitespace-nowrap")}
                  />
                  <SortHeader
                    label="Date"
                    field="date"
                    sortField={sortField}
                    sortDir={sortDir}
                    onSort={handleSort}
                    className={cn(CELL_X, "whitespace-nowrap")}
                  />
                  <PlainHeader className={cn(CELL_X, "whitespace-nowrap")}>
                    Eyes
                  </PlainHeader>
                  <SortHeader
                    label="Estimated risk"
                    field="risk"
                    sortField={sortField}
                    sortDir={sortDir}
                    onSort={handleSort}
                    className={cn(CELL_X, "whitespace-nowrap")}
                  />
                  <PlainHeader className={cn(CELL_X, "whitespace-nowrap")}>
                    Model
                  </PlainHeader>
                  <SortHeader
                    label="Your conclusion"
                    field="doctorDecision"
                    sortField={sortField}
                    sortDir={sortDir}
                    onSort={handleSort}
                    className={cn(CELL_X, "whitespace-nowrap")}
                  />
                  <PlainHeader align="right" className="px-2">
                    <span className="sr-only">Actions</span>
                  </PlainHeader>
                </tr>
              </thead>

              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={7}>
                      <Loading label="Loading screenings…" />
                    </td>
                  </tr>
                )}

                {!loading && visible.length === 0 && (
                  <tr>
                    <td colSpan={7}>
                      <EmptyState
                        title="No screenings match"
                        hint="Try a different search, or clear the filter."
                      />
                    </td>
                  </tr>
                )}

                {!loading &&
                  visible.map((detection) => {
                    const verdict = verdictFor(detection);
                    const decision = detection.doctorDecision ?? "Pending";

                    return (
                      <tr
                        key={detection.id}
                        className="border-b border-line-soft transition-colors last:border-0 hover:bg-inset/60"
                      >
                        <td className={cn(CELL_X, "py-3.5")}>
                          <Link
                            to={`/app/detection/${detection.id}`}
                            className="group block"
                          >
                            <span className="block text-body font-medium text-ink underline-offset-4 group-hover:underline">
                              {detection.patientName}
                            </span>
                            <span className="mt-0.5 block text-micro text-ink-3 tabular-nums">
                              {detection.patientId}
                            </span>
                          </Link>
                        </td>
                        <td className={CELL}>{formatDate(detection.date)}</td>
                        <td className={cn(CELL, "normal-nums")}>
                          {detection.eye === "Both" ? "Both" : detection.eye}
                        </td>
                        <td className={cn(CELL_X, "py-3.5")}>
                          <span className="flex items-center gap-2.5">
                            <RiskBar
                              percent={riskPercent(detection.risk)}
                              className="h-1.5 w-16"
                            />
                            <span className="text-body text-ink-2 tabular-nums">
                              {formatRisk(detection.risk)}
                            </span>
                          </span>
                        </td>
                        <td className={cn(CELL_X, "py-3.5")}>
                          <Chip
                            tone={detection.flagged ? "urgent" : "neutral"}
                            dot={false}
                            className={PILL}
                          >
                            {detection.flagged ? "Flagged" : "Not flagged"}
                          </Chip>
                        </td>
                        <td className={cn(CELL_X, "py-3.5")}>
                          {decision === "Pending" ? (
                            <Chip tone="watch" className={PILL}>
                              {SHORT_DECISION.Pending}
                            </Chip>
                          ) : (
                            <span className="flex flex-wrap items-center gap-2">
                              <Chip tone={stateTone(verdict.state)} className={PILL}>
                                {SHORT_DECISION[decision] ?? decision}
                              </Chip>
                              {verdict.disputed && (
                                <span className="text-label text-watch">
                                  disagreed
                                </span>
                              )}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-3.5">
                          <div className="flex justify-end">
                            <IconButton
                              icon={Trash2}
                              tone="danger"
                              label={`Delete the screening of ${detection.patientName} on ${formatDate(detection.date)}`}
                              onClick={() => void handleDelete(detection)}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>

          {!loading && visible.length > 0 && (
            <p className="mt-4 text-label text-ink-3">
              Showing {visible.length} of {detections.length}
            </p>
          )}
        </Band>
      </div>
    </AppPage>
  );
}
