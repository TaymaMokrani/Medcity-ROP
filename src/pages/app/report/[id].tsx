import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Download, Printer } from "lucide-react";
import { Button, ErrorBand, InlineError, Loading } from "@/components/ui";
import { useAuth } from "@/hooks/auth-context";
import { SEVERITY_LABEL } from "@/components/ui/tone";
import { errorMessage } from "@/lib/api";
import AuthImage from "@/components/app/AuthImage";
import { daysOfLife, formatDate, formatPma } from "@/lib/format";
import {
  formatRisk,
  getDetectionById,
  getFhirBundle,
  type Detection,
} from "@/lib/detections";
import { getPatientById, type Patient } from "@/lib/patients";
import { eyeName, getSeverity, worstEyeFirst, type SeverityState } from "@/lib/severity";
import { useTitle } from "@/hooks/useTitle";

/**
 * The findings report, laid out to be printed.
 *
 * It sits outside the app frame on purpose. Inside it, printing produced one
 * page with the navigation rail down the side and everything past the first
 * screenful clipped off, because the frame is a fixed-height scrolling box.
 * A document that is meant to be filed should be a document.
 *
 * Everything on it is attributed: what was measured, what was refused, and what
 * the examiner entered. A report that quietly omitted the refusals would read
 * as a complete assessment, which is the one thing this must never look like.
 */
export default function ScreeningReport() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [detection, setDetection] = useState<Detection | null>(null);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [severity, setSeverity] = useState<SeverityState | null>(null);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const { user } = useAuth();

  useTitle(
    detection
      ? `Report · ${detection.patientName} · ${formatDate(detection.date)}`
      : "Report",
  );

  useEffect(() => {
    if (!id) return;
    async function load(detectionId: string) {
      try {
        const record = await getDetectionById(detectionId);
        if (!record) {
          setError("This screening does not exist.");
          return;
        }
        setDetection(record);
        const [who, state] = await Promise.all([
          getPatientById(record.patientId).catch(() => undefined),
          getSeverity(detectionId).catch(() => null),
        ]);
        setPatient(who ?? null);
        setSeverity(state);
      } catch (e) {
        setError(errorMessage(e, "Could not load this report."));
      }
    }
    void load(id);
  }, [id]);

  if (error) {
    return (
      <main className="app-scope mx-auto max-w-3xl p-10">
        <ErrorBand message={error} />
      </main>
    );
  }
  if (!detection) {
    return (
      <main className="app-scope mx-auto max-w-3xl p-10">
        <Loading label="Loading the report…" />
      </main>
    );
  }

  const summary = severity?.summary ?? null;
  const decision = detection.doctorDecision ?? "Pending";
  const generated = new Date();

  /**
   * Hands the screening over in the format a hospital record system files.
   *
   * The bundle is built by the gateway, which also writes the export to the
   * activity log — a record leaving this system for one it cannot see is a
   * disclosure, and it should be possible to say afterwards that it happened.
   */
  async function exportFhir() {
    setExporting(true);
    setExportError("");
    try {
      const bundle = await getFhirBundle(detection!.id);
      const blob = new Blob([JSON.stringify(bundle, null, 2)], {
        type: "application/fhir+json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `rop-${detection!.id}-fhir.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportError(errorMessage(e, "The export could not be prepared."));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="app-scope min-h-dvh bg-bg py-8 text-ink print:bg-white print:py-0">
      <div className="mx-auto max-w-3xl rounded-2xl border border-line bg-panel p-8 shadow-sm print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <style>
          {/* Sections are kept whole, and a table never leaves its heading
              stranded at the foot of a page. Browsers honour these; anything
              they do not honour degrades to the page break they would have
              made anyway. */}
          {`@page { size: A4; margin: 16mm; }
            @media print {
              h2 { break-after: avoid-page; }
              tr, figure, li { break-inside: avoid; }
            }`}
        </style>

        <div className="mb-8 print:hidden">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button
              icon={ArrowLeft}
              onClick={() => navigate(`/app/detection/${detection.id}`)}
            >
              Back to the screening
            </Button>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                icon={Download}
                busy={exporting}
                onClick={() => void exportFhir()}
                title="Downloads this report as an HL7 FHIR bundle"
              >
                Export for a hospital system
              </Button>
              <Button variant="primary" icon={Printer} onClick={() => window.print()}>
                Print
              </Button>
            </div>
          </div>
          {exportError && <InlineError>{exportError}</InlineError>}
        </div>

        <header className="border-b border-line pb-5">
          <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-2">
            <p className="text-micro uppercase tracking-[0.2em] text-ink-3">
              Retinopathy of prematurity · screening report
            </p>
            {/* A document anyone may be holding a printout of needs to say
                which record it is and when it was made. */}
            <p className="text-micro tabular-nums text-ink-3">
              {detection.id} · issued{" "}
              {generated.toLocaleString("en-GB", {
                day: "2-digit",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          </div>
          <h1 className="mt-2 font-heading text-display text-ink">
            {detection.patientName}
          </h1>
          <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Fact label="Patient" value={detection.patientId} />
            <Fact label="Examined" value={formatDate(detection.date)} />
            <Fact label="Eyes" value={detection.eye} />
            {patient ? (
              <Fact
                label="At examination"
                value={`PMA ${formatPma(patient.dateOfBirth, patient.gestationalAge)} · ${daysOfLife(patient.dateOfBirth)}d`}
              />
            ) : (
              <Fact
                label="Analysed"
                value={
                  severity?.analysedAt
                    ? formatDate(severity.analysedAt.slice(0, 10))
                    : "—"
                }
              />
            )}
            {patient && (
              <>
                <Fact label="Born" value={formatDate(patient.dateOfBirth)} />
                <Fact
                  label="Gestational age at birth"
                  value={`${patient.gestationalAge} weeks`}
                />
                <Fact label="Birth weight" value={`${patient.birthWeight} g`} />
                <Fact
                  label="Analysed"
                  value={
                    severity?.analysedAt
                      ? formatDate(severity.analysedAt.slice(0, 10))
                      : "—"
                  }
                />
              </>
            )}
          </dl>
        </header>

        {/* The doctor's conclusion first: it is the diagnosis, and the report
            used to leave it out entirely. */}
        <Section title="The examining clinician">
          <p className="text-lead text-ink">
            {decision === "Pending" ? "No conclusion recorded yet" : decision}
            {detection.decidedAt && decision !== "Pending" && (
              <span className="text-ink-3">
                {" "}
                · recorded {formatDate(detection.decidedAt.slice(0, 10))}
              </span>
            )}
          </p>

          <table className="mt-4 w-full text-body">
            <tbody className="divide-y divide-line-soft">
              {(["Right", "Left"] as const).map((side) => {
                const stage = severity?.icropStages?.[side];
                const finding = severity?.examinerFindings?.[side];
                const said = [
                  stage !== undefined && stage !== null ? `stage ${stage}` : null,
                  finding?.zone ? `zone ${finding.zone}` : null,
                  finding?.plus ? `plus ${finding.plus}` : null,
                ].filter(Boolean);
                if (said.length === 0) return null;
                return (
                  <tr key={side}>
                    <td className="w-32 py-2 text-ink-3">{side} eye</td>
                    <td className="py-2 capitalize text-ink">{said.join(" · ")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {detection.notes && (
            <p className="mt-4 max-w-prose text-body leading-relaxed text-ink-2">
              {detection.notes}
            </p>
          )}
        </Section>

        <Section title="Photographs examined">
          <div className="grid grid-cols-5 gap-2">
            {(detection.images ?? []).slice(0, 10).map((image, i) => (
              <figure key={`${image.url}-${i}`} className="m-0 break-inside-avoid">
                <AuthImage
                  src={image.url}
                  alt={`${image.eye} eye, photograph ${i + 1}`}
                  className="aspect-square w-full rounded-md border border-line bg-black object-cover"
                  frameClassName="aspect-square w-full rounded-md border border-line"
                />
                <figcaption className="mt-1 text-micro text-ink-3">
                  {image.eye === "Left" ? "L" : "R"}
                  {i + 1}
                </figcaption>
              </figure>
            ))}
          </div>
          <p className="mt-2 text-micro text-ink-3">
            {(detection.images ?? []).length} photographs recorded with this
            screening.
          </p>
        </Section>

        <Section title="Phase 1 — screening">
          <p className="max-w-prose text-body leading-relaxed text-ink-2">
            Estimated risk of ROP per eye, from the screening model, which reads the
            photographs together with the gestational age and birth weight.
          </p>
          <ul className="mt-3 divide-y divide-line-soft border-y border-line-soft">
            {(detection.eyeResults ?? []).map((eye) => (
              <li
                key={eye.eye}
                className="flex items-baseline justify-between gap-6 py-2.5"
              >
                <span className="text-body text-ink-2">{eye.eye} eye</span>
                <span className="text-body text-ink tabular-nums">
                  {formatRisk(eye.risk)}
                  <span className="ml-2 text-ink-3">
                    {eye.flagged ? "flagged" : "not flagged"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Section>

        {!summary ? (
          <Section title="Phase 2 — severity">
            <p className="text-body text-ink-2">
              The severity analysis has not been run for this screening.
            </p>
          </Section>
        ) : (
          <>
            <Section title="Phase 2 — severity">
              <p className="font-heading text-title text-ink">
                {SEVERITY_LABEL[summary.patient.severity]}
              </p>
              <p className="mt-1 max-w-prose text-body leading-relaxed text-ink-2">
                {summary.patient.action}
              </p>
              {(summary.patient.notes ?? []).map((note) => (
                <p key={note} className="mt-2 text-label leading-relaxed text-ink-3">
                  {note}
                </p>
              ))}
            </Section>

            {worstEyeFirst(summary.eyes).map((eye) => (
              <Section key={eye.eye} title={`${eyeName(eye.eye)} eye — measured`}>
                <p className="text-body text-ink">
                  <span className="font-medium">{SEVERITY_LABEL[eye.severity]}</span>
                  {" — "}
                  {eye.action}
                </p>

                <table className="mt-4 w-full text-body">
                  <tbody className="divide-y divide-line-soft">
                    <Row
                      label="Zone"
                      value={
                        eye.icrop.zone.value
                          ? `Zone ${eye.icrop.zone.value}`
                          : "Not assessable"
                      }
                      source={eye.icrop.zone.source}
                    />
                    <Row
                      label="Plus disease"
                      value={String(eye.icrop.plus.value ?? "Not assessable")}
                      source={
                        eye.icrop.plus.source === "measured"
                          ? "measured (provisional)"
                          : eye.icrop.plus.source
                      }
                    />
                    <Row
                      label="Stage"
                      value="Not measured"
                      source="the analyser does not detect the ridge"
                    />
                  </tbody>
                </table>

                <ul className="mt-4 space-y-1.5">
                  {eye.findings.map((finding) => (
                    <li
                      key={finding}
                      className="flex gap-2 text-label leading-relaxed text-ink-3"
                    >
                      <span className="mt-1.5 size-1 shrink-0 rounded-full bg-ink-3" />
                      {finding}
                    </li>
                  ))}
                </ul>

                <p className="mt-3 text-micro text-ink-3">
                  {eye.n_aligned} of {eye.n_images} photographs aligned ·{" "}
                  {eye.level_meaning}
                </p>

                {eye.evidence.map && (
                  <figure className="mt-4 break-inside-avoid">
                    <AuthImage
                      src={eye.evidence.map}
                      alt={`${eyeName(eye.eye)} eye, measured vessels on the joined map`}
                      className="w-full rounded-lg border border-line bg-black"
                      frameClassName="h-64 w-full rounded-lg border border-line"
                    />
                    <figcaption className="mt-1.5 text-micro text-ink-3">
                      Measured vessels projected onto the joined map. The red ring
                      marks the edge of Zone I.
                    </figcaption>
                  </figure>
                )}
              </Section>
            ))}

            <Section title="Limitations">
              <p className="max-w-prose text-label leading-relaxed text-ink-3">
                {summary.provisional_note}
              </p>
              <p className="mt-2 max-w-prose text-label leading-relaxed text-ink-3">
                Stage is not measured by this system and is recorded by the
                examining clinician. Where zone is reported as not assessable, the
                photographs did not extend past where the vessels stop; that is not
                the same as finding no Zone I disease.
              </p>
            </Section>
          </>
        )}

        <Section title="Signature">
          <div className="grid gap-8 sm:grid-cols-2">
            <div>
              <p className="text-body text-ink">{user?.name ?? "—"}</p>
              <p className="mt-0.5 text-micro text-ink-3">
                Prepared by · examining clinician
              </p>
              <div className="mt-10 border-t border-line pt-1.5">
                <p className="text-micro text-ink-3">Signature</p>
              </div>
            </div>
            <div>
              <p className="text-body tabular-nums text-ink">
                {formatDate(detection.date)}
              </p>
              <p className="mt-0.5 text-micro text-ink-3">Date of examination</p>
              <div className="mt-10 border-t border-line pt-1.5">
                <p className="text-micro text-ink-3">Date signed</p>
              </div>
            </div>
          </div>
        </Section>

        <footer className="mt-10 border-t border-line pt-5">
          <p className="max-w-prose text-label leading-relaxed text-ink-3">
            Research prototype. Decision support only. Not validated for clinical
            use. The diagnosis is the examining clinician's.
          </p>
          <p className="mt-2 text-micro tabular-nums text-ink-3">
            {detection.patientName} · {detection.id} · {formatDate(detection.date)}
          </p>
        </footer>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8 break-inside-avoid">
      <h2 className="text-micro uppercase tracking-[0.16em] text-ink-3">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-micro uppercase tracking-[0.14em] text-ink-3">{label}</dt>
      <dd className="mt-0.5 text-body text-ink">{value}</dd>
    </div>
  );
}

function Row({
  label,
  value,
  source,
}: {
  label: string;
  value: string;
  source: string;
}) {
  return (
    <tr>
      <td className="w-32 py-2 text-ink-3">{label}</td>
      <td className="py-2 capitalize text-ink">{value}</td>
      <td className="py-2 text-right text-label text-ink-3">{source}</td>
    </tr>
  );
}
