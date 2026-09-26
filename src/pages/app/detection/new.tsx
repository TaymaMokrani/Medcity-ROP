import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  RotateCcw,
  Save,
  ScanLine,
  UserPlus,
} from "lucide-react";
import AppPage from "@/components/app/AppPage";
import PatientBanner from "@/components/app/PatientBanner";
import EyeUploader, { type PickedImage } from "@/components/app/detection/EyeUploader";
import PatientPicker from "@/components/app/detection/PatientPicker";
import QuickPatientModal from "@/components/app/detection/QuickPatientModal";
import ResultCard from "@/components/app/detection/ResultCard";
import Lightbox from "@/components/app/detection/Lightbox";
import CaptureNote from "@/components/app/detection/CaptureNote";
import ScanningRetina from "@/components/app/detection/ScanningRetina";
import Disclaimer from "@/components/app/detection/Disclaimer";
import ExaminerRecord, {
  type ExaminerEntry,
} from "@/components/app/detection/ExaminerRecord";
import SeverityStep from "@/components/app/detection/severity/SeverityStep";
import {
  Band,
  Button,
  Chip,
  ErrorBand,
  Field,
  TextInput,
  Textarea,
} from "@/components/ui";
import { getPatients, type Patient } from "@/lib/patients";
import {
  addDetection,
  analyzeDetection,
  REQUIRED_IMAGES_PER_EYE,
  type DetectionImage,
  type Eye,
  type EyeVerdict,
} from "@/lib/detections";
import { EYE_ABBREVIATION, EYE_ORDER } from "@/lib/eyes";
import { readMeasureLine, writeMeasureLine } from "@/lib/threshold";
import { errorMessage } from "@/lib/api";
import { today } from "@/lib/format";
import { useUnsavedWork } from "@/hooks/unsaved";
import type { IcropStage, PlusGrade, SeverityEye, Zone } from "@/lib/severity";
import { useTitle } from "@/hooks/useTitle";

type Step = "capture" | "analysing" | "result";

/**
 * How long the analysing step stays on screen at the least.
 *
 * The model answers in well under a second, which read as a page that flinched
 * rather than a page that worked: the screen changed twice before anyone could
 * see what had happened. One full turn of the scan is 2.4 seconds, so the wait
 * is held to that — long enough to register that ten photographs were read, and
 * short enough not to be padding. Nothing is slowed down but the telling.
 */
const MIN_ANALYSING_MS = 2400;

/** Waits out the remainder of that window, if any is left. */
function settle(startedAt: number): Promise<void> {
  const left = MIN_ANALYSING_MS - (Date.now() - startedAt);
  if (left <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, left));
}

/**
 * A new screening.
 *
 * Three things drove this rebuild. No patient is chosen for you — the first in
 * the list used to be, which is how a screening lands on the wrong baby. The
 * analysis lives only in this page until it is saved, so leaving asks first and
 * saving mid-analysis is refused rather than silently dropping a minute of
 * work. And the eyes are in clinical order, right first, labelled OD and OS.
 */
export default function NewScreening() {
  useTitle("New screening");
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [patients, setPatients] = useState<Patient[]>([]);
  const [patientId, setPatientId] = useState(params.get("patient") ?? "");
  const [loadError, setLoadError] = useState("");
  const [showNewPatient, setShowNewPatient] = useState(false);

  const [step, setStep] = useState<Step>("capture");
  const [eyeSide, setEyeSide] = useState<"Left" | "Right" | "Both">("Both");
  const [date, setDate] = useState(today());
  const [leftImages, setLeftImages] = useState<PickedImage[]>([]);
  const [rightImages, setRightImages] = useState<PickedImage[]>([]);
  const [outcomes, setOutcomes] = useState<EyeVerdict[]>([]);
  const [notes, setNotes] = useState("");
  const [lightbox, setLightbox] = useState<{ eye: Eye; index: number } | null>(null);

  const [severityJobId, setSeverityJobId] = useState<string | null>(null);
  const [severityRunning, setSeverityRunning] = useState(false);
  const [measured, setMeasured] = useState<SeverityEye[]>([]);
  const [examiner, setExaminer] = useState<Partial<Record<Eye, ExaminerEntry>>>({});
  const [measureLine, setMeasureLine] = useState(readMeasureLine);

  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const objectUrls = useRef<string[]>([]);
  useEffect(() => {
    const urls = objectUrls.current;
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    getPatients()
      .then(setPatients)
      .catch((e) =>
        setLoadError(errorMessage(e, "Could not load the patient list.")),
      );
  }, []);

  const activeEyes: Eye[] = useMemo(
    () => EYE_ORDER.filter((eye) => eyeSide === "Both" || eyeSide === eye),
    [eyeSide],
  );

  const patient = patients.find((p) => p.id === patientId) ?? null;

  function imagesFor(eye: Eye) {
    return eye === "Left" ? leftImages : rightImages;
  }

  function setImagesFor(eye: Eye, images: PickedImage[]) {
    if (eye === "Left") setLeftImages(images);
    else setRightImages(images);
  }

  function addImages(eye: Eye, incoming: FileList | File[]) {
    const files = Array.from(incoming).filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) return;

    const current = imagesFor(eye);
    const room = REQUIRED_IMAGES_PER_EYE - current.length;
    if (room <= 0) {
      setNotice(
        `The ${eye.toLowerCase()} eye already has its ${REQUIRED_IMAGES_PER_EYE} photographs.`,
      );
      return;
    }

    const accepted = files.slice(0, room);
    setNotice(
      accepted.length < files.length
        ? `Only ${accepted.length} added — the model reads exactly ${REQUIRED_IMAGES_PER_EYE} photographs per eye.`
        : "",
    );

    setImagesFor(eye, [
      ...current,
      ...accepted.map((file, i) => {
        const preview = URL.createObjectURL(file);
        objectUrls.current.push(preview);
        return { id: `${Date.now()}-${i}-${file.name}`, file, preview };
      }),
    ]);
  }

  function removeImage(eye: Eye, id: string) {
    const image = imagesFor(eye).find((img) => img.id === id);
    if (image) URL.revokeObjectURL(image.preview);
    setImagesFor(
      eye,
      imagesFor(eye).filter((img) => img.id !== id),
    );
    setNotice("");
  }

  function filesToSubmit() {
    return {
      left: activeEyes.includes("Left") ? leftImages.map((i) => i.file) : [],
      right: activeEyes.includes("Right") ? rightImages.map((i) => i.file) : [],
    };
  }

  const ready =
    Boolean(patientId) &&
    Boolean(date) &&
    activeEyes.every((eye) => imagesFor(eye).length === REQUIRED_IMAGES_PER_EYE);

  const imageCount = activeEyes.reduce((sum, eye) => sum + imagesFor(eye).length, 0);

  // Everything on this page is in the browser until it is saved.
  useUnsavedWork(
    step === "result",
    "This screening has been analysed but not saved.",
  );

  async function handleAnalyse() {
    if (!ready) return;
    setStep("analysing");
    setError("");
    const startedAt = Date.now();
    try {
      const results = await analyzeDetection(eyeSide, filesToSubmit(), {
        patientId,
        date,
      });
      await settle(startedAt);
      setOutcomes(results);
      setStep("result");
    } catch (e) {
      await settle(startedAt);
      setError(errorMessage(e, "The analysis did not finish. Please try again."));
      setStep("capture");
    }
  }

  async function handleSave() {
    if (!patient) return;
    setSaving(true);
    setError("");
    try {
      const saved = await addDetection(
        {
          patientId,
          patientName: `${patient.firstName} ${patient.lastName}`,
          date,
          eye: eyeSide,
          notes,
        },
        filesToSubmit(),
        {
          severityJobId: severityJobId ?? undefined,
          icropStages: stagesOf(examiner),
          examinerFindings: findingsOf(examiner),
        },
      );
      navigate(`/app/detection/${saved.id}`, { replace: true });
    } catch (e) {
      setError(errorMessage(e, "The screening could not be saved."));
      setSaving(false);
    }
  }

  function handleReset() {
    [...leftImages, ...rightImages].forEach((img) =>
      URL.revokeObjectURL(img.preview),
    );
    setStep("capture");
    setLeftImages([]);
    setRightImages([]);
    setOutcomes([]);
    setSeverityJobId(null);
    setMeasured([]);
    setExaminer({});
    setNotes("");
    setNotice("");
    setError("");
  }

  const lightboxImages: DetectionImage[] = lightbox
    ? imagesFor(lightbox.eye).map((image) => ({
        url: image.preview,
        eye: lightbox.eye,
      }))
    : [];

  return (
    <AppPage>
      <div className="p-6 md:p-10">
        {patient ? (
          <PatientBanner
            patient={patient}
            patientName={`${patient.firstName} ${patient.lastName}`}
            patientId={patient.id}
            compact
            actions={
              <Button
                icon={ArrowLeft}
                onClick={() => navigate("/app/detection")}
                disabled={saving}
              >
                Leave
              </Button>
            }
          />
        ) : (
          <header className="mb-6">
            <h1 className="font-heading text-display text-ink">New screening</h1>
            <p className="mt-1.5 text-body text-ink-3">
              Choose the patient, then attach {REQUIRED_IMAGES_PER_EYE} photographs
              per eye.
            </p>
          </header>
        )}

        {loadError && (
          <div className="mb-6">
            <ErrorBand message={loadError} />
          </div>
        )}

        {/* ------------------------------------------------------ capture */}
        {step === "capture" && (
          <>
            <Band title="Who and when">
              <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                <PatientPicker
                  patients={patients}
                  value={patientId}
                  onChange={setPatientId}
                  onAddPatient={() => setShowNewPatient(true)}
                />

                <Field
                  label="Date of the examination"
                  hint="Today by default. Change it if you are recording an earlier examination."
                >
                  {(props) => (
                    <TextInput
                      {...props}
                      type="date"
                      max={today()}
                      value={date}
                      onChange={(event) => setDate(event.target.value)}
                    />
                  )}
                </Field>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button icon={UserPlus} onClick={() => setShowNewPatient(true)}>
                  Add a patient
                </Button>
                <p className="text-label text-ink-3">
                  A baby who is not on the list yet can be added without leaving this
                  screening.
                </p>
              </div>
            </Band>

            <Band title="Eyes" meta="Right eye first, as it is written in the notes">
              <div className="flex flex-wrap gap-2">
                {(["Both", "Right", "Left"] as const).map((side) => (
                  <button
                    key={side}
                    type="button"
                    aria-pressed={eyeSide === side}
                    onClick={() => setEyeSide(side)}
                    className={
                      eyeSide === side
                        ? "cursor-pointer rounded-lg border border-[var(--app-primary-line)] bg-[var(--app-primary-bg)] px-4 py-2 text-body font-medium text-[var(--app-primary-ink)]"
                        : "cursor-pointer rounded-lg border border-line bg-panel px-4 py-2 text-body text-ink-2 transition-colors hover:bg-inset hover:text-ink"
                    }
                  >
                    {side === "Both"
                      ? "Both eyes"
                      : `${side} · ${EYE_ABBREVIATION[side as Eye]}`}
                  </button>
                ))}
              </div>
            </Band>

            <Band
              title="Photographs"
              meta={`Exactly ${REQUIRED_IMAGES_PER_EYE} per eye`}
            >
              {notice && (
                <p className="mb-4 flex items-start gap-2 text-label text-watch">
                  <AlertTriangle className="mt-px size-4 shrink-0" aria-hidden />
                  {notice}
                </p>
              )}

              <div
                className={
                  activeEyes.length > 1
                    ? "grid items-start gap-5 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_18rem]"
                    : "grid items-start gap-5 md:grid-cols-[minmax(0,1fr)_18rem]"
                }
              >
                {activeEyes.map((eye) => (
                  <EyeUploader
                    key={eye}
                    eye={eye}
                    images={imagesFor(eye)}
                    onAdd={(files) => addImages(eye, files)}
                    onRemove={(id) => removeImage(eye, id)}
                    onOpen={(index) => setLightbox({ eye, index })}
                  />
                ))}
                <CaptureNote />
              </div>
            </Band>

            {error && (
              <div className="mt-6">
                <ErrorBand message={error} />
              </div>
            )}

            <div className="mt-8 flex flex-wrap items-center justify-end gap-3 border-t border-line pt-6">
              <p className="mr-auto text-label text-ink-3">
                {ready
                  ? `${imageCount} photographs ready.`
                  : `Choose a patient and attach ${REQUIRED_IMAGES_PER_EYE} photographs per eye.`}
              </p>
              <Button onClick={() => navigate("/app/detection")}>Cancel</Button>
              <Button
                variant="primary"
                size="lg"
                icon={ScanLine}
                disabled={!ready}
                onClick={() => void handleAnalyse()}
              >
                Run the screening
              </Button>
            </div>
          </>
        )}

        {/* ---------------------------------------------------- analysing */}
        {step === "analysing" && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <ScanningRetina count={imageCount} />
            <h2 className="mt-8 font-heading text-title text-ink">
              Reading {imageCount} photographs
            </h2>
            <p className="mt-2 max-w-md text-body text-ink-3">
              The model is estimating the risk of ROP for{" "}
              {activeEyes.length > 1 ? "both eyes" : "this eye"}. It takes a few
              seconds.
            </p>
          </div>
        )}

        {/* ------------------------------------------------------- result */}
        {step === "result" && (
          <>
            {/* `flush`: the sticky header draws the rule above this. */}
            <Band title="Screening result" meta="Phase 1 · estimated risk per eye" flush>
              <div
                className={
                  outcomes.length > 1 ? "grid gap-8 sm:grid-cols-2" : "grid gap-8"
                }
              >
                {outcomes.map((outcome) => (
                  <ResultCard
                    key={outcome.eye}
                    label={`${outcome.eye} eye · ${EYE_ABBREVIATION[outcome.eye]}`}
                    risk={outcome.risk}
                    flagged={outcome.flagged}
                    thumbnails={imagesFor(outcome.eye).map((image, i) => ({
                      key: image.id,
                      src: image.preview,
                      // Nothing to open yet: these are not saved photographs.
                      alt: `${outcome.eye} eye, photograph ${i + 1}`,
                    }))}
                  />
                ))}
              </div>

              <div className="mt-6">
                <Disclaimer />
              </div>
            </Band>

            <Band flush className="mt-10 border-t border-line pt-7">
              <SeverityStep
                eye={eyeSide}
                images={filesToSubmit()}
                meta={{ patientId, date }}
                eyeResults={outcomes}
                threshold={measureLine}
                onThreshold={(value) => {
                  setMeasureLine(value);
                  writeMeasureLine(value);
                }}
                onReady={setSeverityJobId}
                onRunning={setSeverityRunning}
                onMeasured={setMeasured}
              />
            </Band>

            <ExaminerRecord
              eyes={activeEyes}
              measured={measured}
              entries={examiner}
              editing
              onChange={(eye, entry) =>
                setExaminer((current) => ({ ...current, [eye]: entry }))
              }
            />

            <Band title="Notes">
              <Textarea
                rows={3}
                value={notes}
                aria-label="Notes"
                placeholder="Anything worth recording about this examination."
                onChange={(event) => setNotes(event.target.value)}
              />
            </Band>

            {error && (
              <div className="mt-6">
                <ErrorBand message={error} />
              </div>
            )}

            <div className="sticky bottom-4 mt-8 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-panel/95 px-4 py-3 shadow-lg backdrop-blur">
              <Chip tone="watch">Not saved yet</Chip>
              {severityRunning && (
                <p className="text-label text-ink-3">
                  The severity analysis is still running. Saving now would leave it
                  behind.
                </p>
              )}
              <div className="ml-auto flex items-center gap-3">
                <Button icon={RotateCcw} onClick={handleReset} disabled={saving}>
                  Start again
                </Button>
                <Button
                  variant="primary"
                  size="lg"
                  icon={Save}
                  busy={saving}
                  disabled={severityRunning}
                  title={
                    severityRunning
                      ? "Wait for the severity analysis to finish, or start again without it"
                      : undefined
                  }
                  onClick={() => void handleSave()}
                >
                  {severityRunning ? "Analysis running…" : "Save screening"}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      {showNewPatient && (
        <QuickPatientModal
          onClose={() => setShowNewPatient(false)}
          onCreated={(created) => {
            setPatients((current) => [created, ...current]);
            setPatientId(created.id);
            setShowNewPatient(false);
          }}
        />
      )}

      {lightbox && lightboxImages.length > 0 && (
        <Lightbox
          images={lightboxImages}
          index={lightbox.index}
          onIndex={(index) => setLightbox({ eye: lightbox.eye, index })}
          onClose={() => setLightbox(null)}
          caption={patient ? `${patient.firstName} ${patient.lastName}` : undefined}
        />
      )}
    </AppPage>
  );
}

/** The stages, in the shape the create request wants. */
function stagesOf(entries: Partial<Record<Eye, ExaminerEntry>>) {
  const stages: Partial<Record<Eye, IcropStage>> = {};
  for (const [eye, entry] of Object.entries(entries)) {
    if (entry?.stage !== null && entry?.stage !== undefined) {
      stages[eye as Eye] = entry.stage;
    }
  }
  return stages;
}

/** Zone and plus, likewise. Empty axes are left out rather than sent as null. */
function findingsOf(entries: Partial<Record<Eye, ExaminerEntry>>) {
  const findings: Partial<Record<Eye, { zone?: Zone; plus?: PlusGrade }>> = {};
  for (const [eye, entry] of Object.entries(entries)) {
    const one: { zone?: Zone; plus?: PlusGrade } = {};
    if (entry?.zone) one.zone = entry.zone;
    if (entry?.plus) one.plus = entry.plus;
    if (Object.keys(one).length > 0) findings[eye as Eye] = one;
  }
  return findings;
}
