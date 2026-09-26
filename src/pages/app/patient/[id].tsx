import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { AlertCircle, ArrowLeft, Check, Edit3, Trash2, X } from "lucide-react";
import AppPage, { PageSpinner } from "@/components/app/AppPage";
import DetailField from "@/components/app/patient/DetailField";
import GestationalAgeField from "@/components/app/patient/GestationalAgeField";
import PatientDetections from "@/components/app/patient/PatientDetections";
import RiskHistory from "@/components/app/patient/RiskHistory";
import {
  Button,
  Chip,
  ErrorBand,
  Eyebrow,
  Measurements,
  Textarea,
} from "@/components/ui";
import {
  getPatientById,
  updatePatient,
  deletePatient,
  type Patient,
} from "@/lib/patients";
import { errorMessage } from "@/lib/api";
import type { Detection } from "@/lib/detections";
import { formatDate, formatPma } from "@/lib/format";
import {
  summariseByPatient,
  summaryFor,
  stateTone,
  type ScreeningSummary,
} from "@/lib/screening";
import {
  BIRTH_WEIGHT,
  formatWeeks,
  isValid,
  validatePatient,
  type Errors,
} from "@/lib/validation";
import { useUnsavedWork } from "@/hooks/unsaved";
import { useTitle } from "@/hooks/useTitle";

/**
 * One baby's record, in two halves.
 *
 * Left is the card: who this is, how they were born, how to reach the family,
 * and anything written down. Right is the clinical history. They used to run
 * one under the other down a single column, which left the screenings — the
 * reason anyone opens this page — sitting above four blocks of demographics
 * with no way to see both at once.
 *
 * The header carries the name, the record number and the state, and nothing
 * else. Born, gestational age, PMA and age are facts about the baby, so they
 * live in the card with the rest of them rather than being said twice.
 *
 * The "Risk Assessment" card is gone. It printed percentages from a hand-written
 * ladder of gestational age and weight, in the same bars the model's own output
 * uses, and could read "Overall Risk: Low" beside a screening at 85%. Nothing
 * produced those numbers and nothing could check them.
 */
export default function PatientRecord() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [patient, setPatient] = useState<Patient | null>(null);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [form, setForm] = useState<Partial<Patient>>({});
  const [errors, setErrors] = useState<Errors>({});
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    let live = true;
    async function load(patientId: string) {
      try {
        const found = await getPatientById(patientId);
        if (!live) return;
        if (!found) {
          setNotFound(true);
          return;
        }
        setPatient(found);
        setForm(found);
      } catch (e) {
        if (live) setError(errorMessage(e, "Could not load this patient."));
      }
    }
    void load(id);
    return () => {
      live = false;
    };
  }, [id]);

  const summary = useMemo(
    () => summaryFor(summariseByPatient(detections), id ?? ""),
    [detections, id],
  );

  const dirty = useMemo(
    () =>
      Boolean(patient) &&
      JSON.stringify({ ...patient, ...form }) !== JSON.stringify(patient),
    [patient, form],
  );

  useUnsavedWork(editing && dirty, "This patient record has unsaved changes.");
  useTitle(patient ? `${patient.firstName} ${patient.lastName}` : "Patient");

  function update(key: keyof Patient, value: string | number) {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: "" }));
  }

  async function handleSave() {
    if (!id) return;

    // The same checks the new-patient form runs. This page had none at all, so
    // a saved record could be edited into a gestational age of 0 — and that
    // number is read by the screening model.
    const found = validatePatient({
      firstName: form.firstName,
      lastName: form.lastName,
      dateOfBirth: form.dateOfBirth,
      gestationalAge: Number(form.gestationalAge),
      birthWeight: Number(form.birthWeight),
    });
    setErrors(found);
    if (!isValid(found)) return;

    setSaving(true);
    setError("");
    try {
      setPatient(
        await updatePatient(id, {
          ...form,
          gestationalAge: Number(form.gestationalAge),
          birthWeight: Number(form.birthWeight),
        }),
      );
      setEditing(false);
    } catch (e) {
      setError(errorMessage(e, "Could not save your changes."));
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    if (patient) setForm(patient);
    setErrors({});
    setEditing(false);
  }

  async function handleDelete() {
    if (!id) return;
    const confirmed = confirm(
      "Delete this patient record? Their screenings go with it, and this cannot be undone.",
    );
    if (!confirmed) return;

    setError("");
    try {
      await deletePatient(id);
      navigate("/app/patient");
    } catch (e) {
      setError(errorMessage(e, "Could not delete this patient."));
    }
  }

  if (notFound) {
    return (
      <AppPage center>
        <div className="text-center">
          <AlertCircle className="mx-auto mb-4 size-10 text-ink-3" aria-hidden />
          <h2 className="font-heading text-title text-ink">Patient not found</h2>
          <p className="mt-2 text-body text-ink-3">
            The record you are looking for does not exist.
          </p>
          <div className="mt-6 flex justify-center">
            <Button icon={ArrowLeft} onClick={() => navigate("/app/patient")}>
              Back to patients
            </Button>
          </div>
        </div>
      </AppPage>
    );
  }

  if (!patient) return <PageSpinner />;

  const pma = formatPma(patient.dateOfBirth, patient.gestationalAge);

  return (
    <AppPage>
      <div className="p-6 md:p-10">
        <header className="sticky top-0 z-20 -mx-6 mb-8 border-b border-line bg-panel/95 px-6 py-4 backdrop-blur md:-mx-10 md:px-10">
          {/* Baseline, not centre: the record number and the state chip sit on
              the same line the name is written on, rather than floating at the
              middle of a heading three times their size. */}
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
            <h1 className="font-heading text-display leading-none text-ink">
              {patient.firstName} {patient.lastName}
            </h1>

            <span className="text-label text-ink-3 tabular-nums">{patient.id}</span>

            <span className="hidden h-4 w-px self-center bg-line sm:block" aria-hidden />

            <span title={stateSource(summary)}>
              <Chip tone={stateTone(summary.state)}>{summary.state}</Chip>
            </span>

            <div className="ml-auto flex items-center gap-2 self-center">
              {editing ? (
                <>
                  <Button icon={X} onClick={handleCancel} disabled={saving}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    icon={Check}
                    busy={saving}
                    onClick={() => void handleSave()}
                  >
                    Save
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="primary" icon={Edit3} onClick={() => setEditing(true)}>
                    Edit
                  </Button>
                  <Button variant="danger" icon={Trash2} onClick={() => void handleDelete()}>
                    Delete
                  </Button>
                </>
              )}
            </div>
          </div>
        </header>

        {error && (
          <div className="mb-6">
            <ErrorBand message={error} />
          </div>
        )}

        {/* Two halves: who this baby is, and what the screenings found. */}
        <div className="grid items-start gap-8 lg:grid-cols-[28rem_minmax(0,1fr)]">
          <section className="overflow-hidden rounded-xl border border-line bg-panel">
            <CardSection title="Identity">
              <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-3">
                <DetailField
                  label="First name"
                  required
                  value={form.firstName ?? ""}
                  editing={editing}
                  error={errors.firstName}
                  onChange={(v) => update("firstName", v)}
                />
                <DetailField
                  label="Last name"
                  required
                  value={form.lastName ?? ""}
                  editing={editing}
                  error={errors.lastName}
                  onChange={(v) => update("lastName", v)}
                />
                <DetailField
                  label="Sex"
                  type="select"
                  options={["Female", "Male"]}
                  value={form.gender ?? "Female"}
                  editing={editing}
                  onChange={(v) => update("gender", v)}
                />
                <DetailField
                  label="Date of birth"
                  type="date"
                  required
                  value={form.dateOfBirth ?? ""}
                  displayValue={formatDate(patient.dateOfBirth)}
                  editing={editing}
                  error={errors.dateOfBirth}
                  onChange={(v) => update("dateOfBirth", v)}
                />
                <div>
                  <p className="text-label text-ink-3">PMA now</p>
                  <p className="mt-1 text-body text-ink tabular-nums">{pma}</p>
                </div>
              </div>
            </CardSection>

            <CardSection title="Birth" meta="Read by the model">
              <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-3">
                {editing ? (
                  // The weeks-and-days pair needs the room two columns give it.
                  <div className="sm:col-span-2">
                    <GestationalAgeField
                      value={String(form.gestationalAge ?? "")}
                      error={errors.gestationalAge}
                      onChange={(weeks) => update("gestationalAge", weeks)}
                    />
                  </div>
                ) : (
                  <div>
                    <p className="text-label text-ink-3">GA at birth</p>
                    <p className="mt-1 text-body text-ink tabular-nums">
                      {formatWeeks(patient.gestationalAge)} weeks
                    </p>
                  </div>
                )}
                <DetailField
                  label="Birth weight"
                  type="number"
                  required
                  min={BIRTH_WEIGHT.min}
                  max={BIRTH_WEIGHT.max}
                  hint={`${BIRTH_WEIGHT.min}–${BIRTH_WEIGHT.max} g`}
                  value={String(form.birthWeight ?? "")}
                  displayValue={`${patient.birthWeight} g`}
                  editing={editing}
                  error={errors.birthWeight}
                  onChange={(v) => update("birthWeight", v)}
                />
                <DetailField
                  label="Blood type"
                  value={form.bloodType ?? ""}
                  editing={editing}
                  onChange={(v) => update("bloodType", v)}
                />
              </div>
            </CardSection>

            <CardSection title="Family and contact">
              <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
                <DetailField
                  label="Mother's name"
                  value={form.motherName ?? ""}
                  editing={editing}
                  onChange={(v) => update("motherName", v)}
                />
                <DetailField
                  label="Phone"
                  value={form.phone ?? ""}
                  editing={editing}
                  onChange={(v) => update("phone", v)}
                />
                <DetailField
                  label="Email"
                  value={form.email ?? ""}
                  editing={editing}
                  onChange={(v) => update("email", v)}
                />
                <DetailField
                  label="Address"
                  value={form.address ?? ""}
                  editing={editing}
                  onChange={(v) => update("address", v)}
                />
              </div>
            </CardSection>

            <CardSection title="Notes">
              {editing ? (
                <Textarea
                  rows={4}
                  aria-label="Notes"
                  value={form.notes ?? ""}
                  onChange={(event) => update("notes", event.target.value)}
                />
              ) : (
                // `break-words` so a long unbroken string wraps instead of
                // running off the card, `pre-line` so typed line breaks survive.
                <p className="whitespace-pre-line break-words text-body leading-relaxed text-ink-2">
                  {patient.notes || <span className="text-ink-3">No notes</span>}
                </p>
              )}
            </CardSection>

            <CardSection title="Record">
              <Measurements
                rows={[
                  ["Registered", formatDate(patient.createdAt)],
                  [
                    "Screenings",
                    summary.screenings === 0 ? "None yet" : String(summary.screenings),
                  ],
                  [
                    "Last screening",
                    summary.lastScreening ? formatDate(summary.lastScreening) : "—",
                  ],
                ]}
              />
            </CardSection>
          </section>

          <div className="grid gap-8">
            <PatientDetections
              patientId={patient.id}
              onLoad={setDetections}
              meta={openWork(summary)}
            />
            <RiskHistory detections={detections} />
          </div>
        </div>

        {editing && dirty && (
          <div className="sticky bottom-4 mt-8 flex items-center justify-end gap-3 rounded-xl border border-line bg-panel/95 px-4 py-3 shadow-lg backdrop-blur">
            <Chip tone="watch">Unsaved</Chip>
            <Button icon={X} onClick={handleCancel} disabled={saving}>
              Cancel
            </Button>
            <Button
              variant="primary"
              icon={Check}
              busy={saving}
              onClick={() => void handleSave()}
            >
              Save changes
            </Button>
          </div>
        )}
      </div>
    </AppPage>
  );
}

/** One group of fields inside the patient card, hairline-separated. */
function CardSection({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: string;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-line-soft px-5 py-5 first:border-t-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Eyebrow>{title}</Eyebrow>
        {meta && <p className="text-label text-ink-3">{meta}</p>}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/**
 * Whose call the state in the header is. It used to be spelled out on a second
 * line; the chip carries it now, as the reason you get when you rest on it.
 */
function stateSource(summary: ScreeningSummary): string | undefined {
  if (summary.state === "Not screened") return undefined;
  if (summary.source === "doctor") return "Your conclusion";
  return "The model's, pending your conclusion";
}

/** What is still open on this baby, said under the Screenings heading. */
function openWork(summary: ScreeningSummary): string | undefined {
  const parts: string[] = [];
  if (summary.pending > 0) {
    const s = summary.pending === 1 ? "" : "s";
    parts.push(`${summary.pending} screening${s} awaiting your conclusion`);
  }
  if (summary.disputed) parts.push("You and the model disagreed on a screening");
  return parts.length ? parts.join(" · ") : undefined;
}
