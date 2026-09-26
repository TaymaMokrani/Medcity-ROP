import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Plus } from "lucide-react";
import {
  getDetectionsByPatient,
  formatRisk,
  type Detection,
} from "@/lib/detections";
import { verdictFor, stateTone } from "@/lib/screening";
import { errorMessage } from "@/lib/api";
import { formatDate } from "@/lib/format";
import {
  Button,
  Chip,
  EmptyState,
  ErrorBand,
  Eyebrow,
  Loading,
} from "@/components/ui";

/**
 * This baby's screenings, newest first.
 *
 * One of the two halves of the record: the clinical history, beside the card
 * that says who this is. Each row says what the model found and what the
 * examiner concluded, side by side: where they disagree, both are on the row,
 * because a list that showed only one of them would be hiding the disagreement
 * rather than settling it.
 *
 * The flag no longer prints the threshold it was drawn at. Seven rows each
 * repeating "at 40%" was the same number seven times, and the screening's own
 * page says where the line sits.
 */
export default function PatientDetections({
  patientId,
  onLoad,
  meta,
}: {
  patientId: string;
  /**
   * The screenings, once they arrive. The page reads its own summary off them
   * and hands the same list to the risk chart, so the record is fetched once.
   */
  onLoad?: (detections: Detection[]) => void;
  /** A quiet line under the heading, such as how many are still open. */
  meta?: ReactNode;
}) {
  const [detections, setDetections] = useState<Detection[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const found = await getDetectionsByPatient(patientId);
        if (!active) return;
        setDetections(found);
        onLoad?.(found);
      } catch (e) {
        if (active) {
          setError(errorMessage(e, "Could not load this patient's screenings."));
        }
      }
    }
    void load();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  const newScreening = `/app/detection/new?patient=${encodeURIComponent(patientId)}`;

  return (
    <section className="overflow-hidden rounded-xl border border-line bg-panel">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-line px-5 py-4">
        <div>
          <Eyebrow>
            {detections?.length ? `Screenings · ${detections.length}` : "Screenings"}
          </Eyebrow>
          {meta && <p className="mt-1.5 text-label text-ink-3">{meta}</p>}
        </div>
        <Link to={newScreening}>
          <Button size="sm" icon={Plus}>
            New screening
          </Button>
        </Link>
      </header>

      {error && (
        <div className="p-5">
          <ErrorBand message={error} />
        </div>
      )}

      {!error && detections === null && (
        <div className="p-5">
          <Loading label="Loading screenings…" />
        </div>
      )}

      {!error && detections?.length === 0 && (
        <div className="p-5">
          <EmptyState
            title="No screenings recorded yet"
            hint="Photographs of both eyes, five per eye, and the model estimates the risk."
            action={
              <Link to={newScreening}>
                <Button variant="primary" icon={Plus}>
                  Screen this baby
                </Button>
              </Link>
            }
          />
        </div>
      )}

      {!error && detections && detections.length > 0 && (
        <ul className="divide-y divide-line-soft">
          {detections.map((detection) => {
            const verdict = verdictFor(detection);

            return (
              <li key={detection.id}>
                <Link
                  to={`/app/detection/${detection.id}`}
                  className="group flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3.5 transition-colors hover:bg-inset/60"
                >
                  <span className="w-28 shrink-0 text-body text-ink tabular-nums">
                    {formatDate(detection.date)}
                  </span>

                  <span className="w-20 shrink-0 text-label text-ink-3">
                    {detection.eye === "Both" ? "Both eyes" : `${detection.eye} eye`}
                  </span>

                  <span className="w-20 shrink-0 text-label text-ink-2 tabular-nums">
                    {formatRisk(detection.risk)}
                    <span className="text-ink-3"> risk</span>
                  </span>

                  <span className="shrink-0">
                    <Chip tone={detection.flagged ? "urgent" : "neutral"} dot={false}>
                      {detection.flagged ? "Flagged" : "Not flagged"}
                    </Chip>
                  </span>

                  <span className="shrink-0">
                    {verdict.source === "doctor" ? (
                      <Chip tone={stateTone(verdict.state)}>
                        {detection.doctorDecision}
                      </Chip>
                    ) : (
                      <Chip tone="watch">Awaiting your conclusion</Chip>
                    )}
                  </span>

                  {verdict.disputed && (
                    <span className="shrink-0 text-label text-watch">
                      You and the model disagreed
                    </span>
                  )}

                  <ChevronRight
                    className="ml-auto size-4 shrink-0 text-ink-3 transition-colors group-hover:text-ink"
                    aria-hidden
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
