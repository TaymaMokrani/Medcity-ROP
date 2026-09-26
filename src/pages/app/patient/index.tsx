import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";
import AppPage from "@/components/app/AppPage";
import SortHeader, { PlainHeader } from "@/components/app/SortHeader";
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
import { getPatients, deletePatient, type Patient } from "@/lib/patients";
import { getDetections } from "@/lib/detections";
import {
  summariseByPatient,
  summaryFor,
  stateRank,
  stateTone,
  type PatientState,
  type ScreeningSummary,
} from "@/lib/screening";
import { errorMessage } from "@/lib/api";
import { daysOfLife, formatDate, formatPma } from "@/lib/format";
import { formatWeeks } from "@/lib/validation";
import { cn } from "@/lib/utils";
import { useTitle } from "@/hooks/useTitle";

type SortField = "name" | "born" | "pma" | "state" | "lastScreening";

/** The states worth filtering by, in the order they matter. */
const FILTERS: { key: string; label: string; state?: PatientState }[] = [
  { key: "All", label: "All" },
  { key: "Flagged", label: "Flagged", state: "Flagged" },
  { key: "Uncertain", label: "Uncertain", state: "Uncertain" },
  { key: "Clear", label: "Clear", state: "Clear" },
  { key: "Not screened", label: "Not screened", state: "Not screened" },
];

/**
 * One width for every chip in the State column, sized to the longest label,
 * "Not screened". Otherwise the pills change shape on every row and the column
 * has no edge to read down.
 */
const PILL = "w-32 justify-center";

/**
 * One horizontal rhythm for the table. Columns sat 12px apart before, close
 * enough that a date and a gestational age read as one run of numbers.
 */
const CELL_X = "px-5 first:pl-1";
const CELL = `${CELL_X} py-3.5 whitespace-nowrap text-body text-ink-2 tabular-nums`;

/**
 * Every baby on the unit.
 *
 * The columns are the ones a screening decision turns on — how premature, how
 * far along now, what the screenings came to, when the last one was. It used to
 * show date of birth and a hand-typed status, and keep gestational age, risk and
 * conclusion off the table entirely.
 *
 * Rows are links. Opening a patient from the keyboard was impossible before:
 * the row carried a click handler and the only thing Tab could reach in it was
 * a delete button that was invisible until hover.
 */
export default function PatientsIndex() {
  useTitle("Patients");
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [patients, setPatients] = useState<Patient[]>([]);
  const [summaries, setSummaries] = useState<Map<string, ScreeningSummary>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("state");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const filter = params.get("state") ?? "All";

  useEffect(() => {
    async function load() {
      try {
        const [patientList, detections] = await Promise.all([
          getPatients(),
          getDetections(),
        ]);
        setPatients(patientList);
        setSummaries(summariseByPatient(detections));
      } catch (e) {
        setError(errorMessage(e, "Could not load the patients."));
      }
      setLoading(false);
    }
    void load();
  }, []);

  const counts = useMemo(() => {
    const tally = new Map<string, number>();
    for (const patient of patients) {
      const state = summaryFor(summaries, patient.id).state;
      tally.set(state, (tally.get(state) ?? 0) + 1);
    }
    return tally;
  }, [patients, summaries]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();

    return patients
      .filter((p) => {
        const state = summaryFor(summaries, p.id).state;
        if (filter !== "All" && state !== filter) return false;
        if (!query) return true;
        return [p.firstName, p.lastName, p.id, p.motherName]
          .filter(Boolean)
          .some((field) => field.toLowerCase().includes(query));
      })
      .sort((a, b) => {
        const compared = compareBy(sortField, a, b, summaries);
        return sortDir === "asc" ? compared : -compared;
      });
  }, [patients, search, filter, sortField, sortDir, summaries]);

  function handleSort(field: SortField) {
    if (field === sortField) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      // Worst first, newest first: the useful end of each column.
      setSortDir(field === "name" || field === "state" ? "asc" : "desc");
    }
  }

  async function handleDelete(patient: Patient) {
    const confirmed = confirm(
      `Delete ${patient.firstName} ${patient.lastName}? Their screenings go too, and this cannot be undone.`,
    );
    if (!confirmed) return;

    setError("");
    try {
      await deletePatient(patient.id);
      setPatients((current) => current.filter((p) => p.id !== patient.id));
    } catch (e) {
      setError(errorMessage(e, "Could not delete this patient."));
    }
  }

  return (
    <AppPage>
      <div className="p-6 md:p-10">
        <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
          <div>
            <h1 className="font-heading text-display text-ink">Patients</h1>
          </div>
          <Button variant="primary" icon={Plus} onClick={() => navigate("/app/patient/new")}>
            New patient
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
              label="Search patients"
              placeholder="Name, record number or mother"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full sm:max-w-xs"
            />

            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map((option) => {
                const active = filter === option.key;
                const count = option.state ? (counts.get(option.state) ?? 0) : patients.length;
                return (
                  <button
                    key={option.key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      const next = new URLSearchParams(params);
                      if (option.key === "All") next.delete("state");
                      else next.set("state", option.key);
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
                    <span className="ml-1.5 tabular-nums opacity-70">{count}</span>
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
                    field="name"
                    sortField={sortField}
                    sortDir={sortDir}
                    onSort={handleSort}
                    className={cn(CELL_X, "w-[26%] whitespace-nowrap")}
                  />
                  <SortHeader
                    label="Born"
                    field="born"
                    sortField={sortField}
                    sortDir={sortDir}
                    onSort={handleSort}
                    className={cn(CELL_X, "whitespace-nowrap")}
                  />
                  <PlainHeader className={cn(CELL_X, "whitespace-nowrap")}>
                    GA at birth
                  </PlainHeader>
                  <SortHeader
                    label="PMA now"
                    field="pma"
                    sortField={sortField}
                    sortDir={sortDir}
                    onSort={handleSort}
                    className={cn(CELL_X, "whitespace-nowrap")}
                  />
                  <SortHeader
                    label="State"
                    field="state"
                    sortField={sortField}
                    sortDir={sortDir}
                    onSort={handleSort}
                    className={cn(CELL_X, "whitespace-nowrap")}
                  />
                  <SortHeader
                    label="Last screening"
                    field="lastScreening"
                    sortField={sortField}
                    sortDir={sortDir}
                    onSort={handleSort}
                    className={cn(CELL_X, "whitespace-nowrap")}
                  />
                  <PlainHeader align="right" className={cn(CELL_X, "whitespace-nowrap")}>
                    Screenings
                  </PlainHeader>
                  <PlainHeader align="right" className="px-2">
                    <span className="sr-only">Actions</span>
                  </PlainHeader>
                </tr>
              </thead>

              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={8}>
                      <Loading label="Loading patients…" />
                    </td>
                  </tr>
                )}

                {!loading && visible.length === 0 && (
                  <tr>
                    <td colSpan={8}>
                      <EmptyState
                        title="No patients match"
                        hint="Try a different search, or clear the filter."
                      />
                    </td>
                  </tr>
                )}

                {!loading &&
                  visible.map((patient) => {
                    const summary = summaryFor(summaries, patient.id);
                    return (
                      <tr
                        key={patient.id}
                        className="border-b border-line-soft transition-colors last:border-0 hover:bg-inset/60"
                      >
                        <td className={cn(CELL_X, "py-3.5")}>
                          <Link
                            to={`/app/patient/${patient.id}`}
                            className="group block"
                          >
                            <span className="block text-body font-medium text-ink underline-offset-4 group-hover:underline">
                              {patient.firstName} {patient.lastName}
                            </span>
                            <span className="mt-0.5 block text-micro text-ink-3 tabular-nums">
                              {patient.id}
                            </span>
                          </Link>
                        </td>
                        <td className={CELL}>{formatDate(patient.dateOfBirth)}</td>
                        <td className={CELL}>{formatWeeks(patient.gestationalAge)}</td>
                        <td className={CELL}>
                          {formatPma(patient.dateOfBirth, patient.gestationalAge)}
                        </td>
                        <td className={cn(CELL_X, "py-3.5")}>
                          <Chip tone={stateTone(summary.state)} className={PILL}>
                            {summary.state}
                          </Chip>
                          {summary.pending > 0 && (
                            <span className="mt-1 block text-micro text-watch">
                              {summary.pending} to decide
                            </span>
                          )}
                        </td>
                        <td className={CELL}>
                          {summary.lastScreening
                            ? formatDate(summary.lastScreening)
                            : "—"}
                        </td>
                        <td className={cn(CELL, "text-right")}>{summary.screenings}</td>
                        <td className="px-2 py-3.5">
                          <div className="flex justify-end">
                            <IconButton
                              icon={Trash2}
                              tone="danger"
                              label={`Delete ${patient.firstName} ${patient.lastName}`}
                              onClick={() => void handleDelete(patient)}
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
              Showing {visible.length} of {patients.length}
            </p>
          )}
        </Band>
      </div>
    </AppPage>
  );
}

function compareBy(
  field: SortField,
  a: Patient,
  b: Patient,
  summaries: Map<string, ScreeningSummary>,
): number {
  switch (field) {
    case "state":
      return (
        stateRank(summaryFor(summaries, a.id).state) -
        stateRank(summaryFor(summaries, b.id).state)
      );
    case "lastScreening": {
      const left = summaryFor(summaries, a.id).lastScreening ?? "";
      const right = summaryFor(summaries, b.id).lastScreening ?? "";
      return left.localeCompare(right);
    }
    case "born":
      return a.dateOfBirth.localeCompare(b.dateOfBirth);
    case "pma":
      // Same birth date, more weeks at birth means further along now.
      return (
        daysOfLife(a.dateOfBirth) +
        a.gestationalAge * 7 -
        (daysOfLife(b.dateOfBirth) + b.gestationalAge * 7)
      );
    default:
      return `${a.firstName} ${a.lastName}`.localeCompare(
        `${b.firstName} ${b.lastName}`,
      );
  }
}
