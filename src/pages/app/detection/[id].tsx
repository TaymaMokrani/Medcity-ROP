import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Printer,
  ScanEye,
  Trash2,
  X,
} from "lucide-react";
import AppPage, { PageSpinner } from "@/components/app/AppPage";
import PatientBanner from "@/components/app/PatientBanner";
import ResultCard from "@/components/app/detection/ResultCard";
import Disclaimer from "@/components/app/detection/Disclaimer";
import Lightbox from "@/components/app/detection/Lightbox";
import ExaminerRecord, {
  type ExaminerEntry,
} from "@/components/app/detection/ExaminerRecord";
import SeverityPanel from "@/components/app/detection/severity/SeverityPanel";
import ConclusionPanel from "@/components/app/detection/ConclusionPanel";
import {
  Band,
  Button,
  Chip,
  ErrorBand,
} from "@/components/ui";
import {
  deleteDetection,
  getDetectionById,
  updateDetection,
  type Detection,
  type DetectionImage,
  type DoctorDecision,
  type Eye,
} from "@/lib/detections";
import { getPatientById, type Patient } from "@/lib/patients";
import {
  getSeverity,
  setExaminerRecord,
  type SeverityState,
} from "@/lib/severity";
import { errorMessage } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useUnsavedWork } from "@/hooks/unsaved";
import { useTitle } from "@/hooks/useTitle";
import { cn } from "@/lib/utils";

/**
 * One screening.
 *
 * Read in the order the decision is made: who this is, what the model found,
 * what you concluded, then the severity analysis and your own findings under
 * it. Your conclusion used to be at the very bottom, below every measurement
 * for both eyes.
 *
 * One editing mode for the whole page. The decision, the examiner record and
 * the notes were previously saved three different ways — one on click, one on
 * change, one behind an Edit button — so there was no way to know what was
 * already written down. Now Edit opens all of them and Cancel is the undo.
 */
export default function DetectionDetail() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [detection, setDetection] = useState<Detection | null>(null);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [severity, setSeverity] = useState<SeverityState | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState("");

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState("");
  const [decision, setDecision] = useState<DoctorDecision>("Pending");
  const [examiner, setExaminer] = useState<Partial<Record<Eye, ExaminerEntry>>>({});
  const [lightbox, setLightbox] = useState<number | null>(null);

  useEffect(() => {
    if (!id) return;
    let live = true;

    async function load(detectionId: string) {
      try {
        const found = await getDetectionById(detectionId);
        if (!live) return;
        if (!found) {
          setNotFound(true);
          return;
        }
        setDetection(found);
        setNotes(found.notes ?? "");
        setDecision(found.doctorDecision ?? "Pending");

        const [record, state] = await Promise.all([
          getPatientById(found.patientId).catch(() => undefined),
          getSeverity(detectionId).catch(() => null),
        ]);
        if (!live) return;
        setPatient(record ?? null);
        setSeverity(state);
        setExaminer(collectEntries(state));
      } catch (e) {
        if (live) setError(errorMessage(e, "Could not load this screening."));
      }
    }

    void load(id);
    return () => {
      live = false;
    };
  }, [id]);

  const eyes: Eye[] = useMemo(
    () =>
      detection?.eye === "Both"
        ? ["Left", "Right"]
        : detection?.eye
          ? [detection.eye as Eye]
          : [],
    [detection],
  );

  const images: DetectionImage[] = useMemo(() => {
    if (!detection) return [];
    if (detection.images?.length) return detection.images;
    return detection.image
      ? [{ url: detection.image, eye: detection.eye === "Right" ? "Right" : "Left" }]
      : [];
  }, [detection]);

  const saved = useMemo(
    () => ({
      notes: detection?.notes ?? "",
      decision: detection?.doctorDecision ?? "Pending",
      examiner: collectEntries(severity),
    }),
    [detection, severity],
  );

  const dirty =
    notes !== saved.notes ||
    decision !== saved.decision ||
    JSON.stringify(examiner) !== JSON.stringify(saved.examiner);

  useUnsavedWork(
    editing && dirty,
    "This screening has changes you have not saved.",
  );
  useTitle(
    detection
      ? `${detection.patientName} · ${formatDate(detection.date)}`
      : "Screening",
  );

  async function handleSave() {
    if (!id || !detection) return;
    setSaving(true);
    setError("");
    try {
      if (notes !== saved.notes || decision !== saved.decision) {
        setDetection(
          await updateDetection(id, { notes, doctorDecision: decision }),
        );
      }

      for (const eye of eyes) {
        const next = examiner[eye] ?? {};
        const before = saved.examiner[eye] ?? {};
        if (JSON.stringify(next) === JSON.stringify(before)) continue;
        await setExaminerRecord(id, {
          eye,
          stage: next.stage ?? null,
          zone: next.zone ?? null,
          plus: next.plus ?? null,
        });
      }

      setSeverity(await getSeverity(id).catch(() => severity));
      setEditing(false);
    } catch (e) {
      setError(errorMessage(e, "Could not save your changes."));
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setNotes(saved.notes);
    setDecision(saved.decision);
    setExaminer(saved.examiner);
    setEditing(false);
  }

  async function handleDelete() {
    if (!id) return;
    if (!confirm("Delete this screening? This cannot be undone.")) return;
    setError("");
    try {
      await deleteDetection(id);
      navigate("/app/detection");
    } catch (e) {
      setError(errorMessage(e, "Could not delete this screening."));
    }
  }

  if (notFound) {
    return (
      <AppPage center>
        <div className="text-center">
          <AlertCircle className="mx-auto mb-4 size-10 text-ink-3" aria-hidden />
          <h2 className="font-heading text-title text-ink">Screening not found</h2>
          <p className="mt-2 text-body text-ink-3">
            The record you are looking for does not exist.
          </p>
          <div className="mt-6 flex justify-center">
            <Button icon={ArrowLeft} onClick={() => navigate("/app/detection")}>
              Back to screenings
            </Button>
          </div>
        </div>
      </AppPage>
    );
  }

  if (!detection) return <PageSpinner />;

  const perEye = detection.eyeResults ?? [];
  const measured = severity?.summary?.eyes ?? [];

  /**
   * One eye's photographs, each carrying its place in the full set.
   *
   * The index is the one the lightbox reads, so opening a thumbnail from the
   * right eye and paging on walks the whole screening rather than that eye
   * alone. Called with no eye, it returns every photograph.
   */
  function thumbnailsFor(eye?: Eye) {
    return images
      .map((image, index) => ({ image, index }))
      .filter(({ image }) => !eye || image.eye === eye)
      .map(({ image, index }) => ({
        key: `${image.url}-${index}`,
        src: image.url,
        alt: `${image.eye} eye, photograph ${index + 1}`,
        onOpen: () => setLightbox(index),
      }));
  }

  return (
    <AppPage>
      <div className="p-6 md:p-10">
        <PatientBanner
          patient={patient}
          patientName={detection.patientName}
          patientId={detection.patientId}
          meta={
            <div className="flex items-baseline gap-1.5">
              <dt className="text-ink-3">Screened</dt>
              <dd className="text-ink-2 tabular-nums">{formatDate(detection.date)}</dd>
            </div>
          }
          actions={
            // Saving belongs to whatever is being edited: the conclusion panel
            // has its own buttons and the bar at the foot of the page catches
            // everything else. A third pair up here was a third thing to read,
            // and the furthest from the change it would have saved.
            !editing && (
              <>
                <Button
                  icon={ScanEye}
                  onClick={() =>
                    navigate(`/app/workspace?detection=${detection.id}`)
                  }
                >
                  Vessel Workspace
                </Button>
                <Link to={`/app/report/${detection.id}`}>
                  <Button icon={Printer}>Report</Button>
                </Link>
                <Button variant="danger" icon={Trash2} onClick={() => void handleDelete()}>
                  Delete
                </Button>
              </>
            )
          }
        />

        {error && (
          <div className="mb-6">
            <ErrorBand message={error} />
          </div>
        )}

        {/* ------------------------------------- Phase 1, and what you made of it */}
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
          {/* `flush`: the sticky header already draws a rule under itself, and a
              second one here left two hairlines with an empty gap between. */}
          <Band title="Screening result" flush>
            <div
              className={cn(
                "grid gap-8",
                perEye.length > 1 ? "sm:grid-cols-2" : "sm:grid-cols-1",
              )}
            >
              {perEye.length > 0 ? (
                perEye.map((eyeResult) => (
                  <ResultCard
                    key={eyeResult.eye}
                    label={`${eyeResult.eye} eye`}
                    risk={eyeResult.risk}
                    flagged={eyeResult.flagged}
                    thumbnails={thumbnailsFor(eyeResult.eye)}
                  />
                ))
              ) : (
                <ResultCard
                  risk={detection.risk}
                  flagged={detection.flagged}
                  thumbnails={thumbnailsFor()}
                />
              )}
            </div>

            <div className="mt-6">
              <Disclaimer />
            </div>
          </Band>

          <ConclusionPanel
            decision={decision}
            onDecision={setDecision}
            editing={editing}
            recordedAt={
              detection.decidedAt && decision !== "Pending"
                ? formatDate(detection.decidedAt)
                : undefined
            }
            onEdit={() => setEditing(true)}
          />
        </div>

        {/* --------------------------------------------------- Phase 2 */}
        <Band flush className="mt-10 border-t border-line pt-7">
          <SeverityPanel detection={detection} />
        </Band>

        <ExaminerRecord
          eyes={eyes}
          measured={measured}
          entries={examiner}
          editing={editing}
          onChange={(eye, entry) =>
            setExaminer((current) => ({ ...current, [eye]: entry }))
          }
          notes={notes}
          onNotes={setNotes}
          onEdit={() => setEditing(true)}
        />

        {editing && (
          <div className="sticky bottom-4 mt-8 flex items-center justify-end gap-3 rounded-xl border border-line bg-panel/95 px-4 py-3 shadow-lg backdrop-blur">
            <p className="mr-auto text-label text-ink-3">
              {dirty ? <Chip tone="watch">Unsaved</Chip> : "Editing"}
            </p>
            <Button icon={X} onClick={handleCancel} disabled={saving}>
              Cancel
            </Button>
            <Button
              variant="primary"
              icon={Check}
              busy={saving}
              disabled={!dirty}
              onClick={() => void handleSave()}
            >
              Save changes
            </Button>
          </div>
        )}
      </div>

      {lightbox !== null && (
        <Lightbox
          images={images}
          index={lightbox}
          onIndex={setLightbox}
          onClose={() => setLightbox(null)}
          caption={detection.patientName}
        />
      )}
    </AppPage>
  );
}

/** The examiner's findings as the form holds them: one entry per eye. */
function collectEntries(
  state: SeverityState | null,
): Partial<Record<Eye, ExaminerEntry>> {
  const entries: Partial<Record<Eye, ExaminerEntry>> = {};
  const eyes: Eye[] = ["Left", "Right"];
  for (const eye of eyes) {
    const stage = state?.icropStages?.[eye];
    const finding = state?.examinerFindings?.[eye];
    if (stage === undefined && !finding) continue;
    entries[eye] = {
      stage: stage ?? null,
      zone: finding?.zone ?? null,
      plus: finding?.plus ?? null,
    };
  }
  return entries;
}
