import {
  QUADRANTS,
  eyeLabel,
  fmt,
  photoCount,
  pxAndDd,
  type DiscScale,
  type WsEye,
  type WsSession,
} from "@/lib/workspace";
import { SEVERITY_LABEL } from "@/components/ui/tone";
import type { Severity } from "@/lib/severity";
import { formatDate, formatPma } from "@/lib/format";
import { angleAt, distance, measurementName, type Measurement } from "./state";

/**
 * The printable page. Invisible on screen; it is the page when the doctor
 * prints, and "Save as PDF" in the print dialog turns it into a file.
 *
 * Two things were missing, and both were the examiner's. The stage they had
 * entered was replaced by the line "not measured — entered by the examining
 * clinician", which is true of the analyser and false of the page: the value
 * existed and was simply not printed. Their conclusion was absent altogether. A
 * page filed in the notes carrying the machine's findings and none of the
 * doctor's misrepresents the examination.
 *
 * It prints words rather than the codes the database holds — "Could not
 * assess", not "unknown".
 */
export default function PrintReport({
  session,
  snapshot,
  snapshotCaption,
  measurements,
  scale,
}: {
  session: WsSession;
  snapshot: string | null;
  snapshotCaption: string;
  measurements: Measurement[];
  scale: DiscScale | null;
}) {
  const printed = new Date().toLocaleString();
  const record = session.record;

  return (
    <div className="hidden bg-white p-0 font-body text-[11pt] text-black print:block">
      <style>{"@page { size: A4; margin: 14mm; }"}</style>

      <header className="flex items-end justify-between border-b border-black pb-2">
        <div>
          <p className="text-[8pt] uppercase tracking-[0.2em] text-neutral-500">
            MedCity · Vessel Workspace
          </p>
          <h1 className="mt-1 text-[16pt] font-semibold">{session.title}</h1>
          <p className="text-[9.5pt] text-neutral-600">{session.subtitle}</p>
          {record && (
            <p className="mt-0.5 text-[9pt] text-neutral-600">
              {record.patientId}
              {record.dateOfBirth && ` · born ${formatDate(record.dateOfBirth)}`}
              {record.gestationalAge != null &&
                ` · ${record.gestationalAge}w at birth`}
              {record.dateOfBirth &&
                record.gestationalAge != null &&
                ` · PMA ${formatPma(record.dateOfBirth, record.gestationalAge)}`}
            </p>
          )}
        </div>
        <p className="text-right text-[8.5pt] text-neutral-600">Printed {printed}</p>
      </header>

      <p className="mt-3 border-l-2 border-black pl-3 text-[9pt]">
        {session.screened
          ? "Provisional measurements. Decision support only — not a diagnosis."
          : "Not screened by Phase 1. Measurements only — no severity and no action are given. Provisional; not validated for clinical use."}
      </p>

      {/* The examiner's own record comes before the machine's: it is the one
          thing on this page a person is accountable for. */}
      {record && (
        <section className="mt-4 break-inside-avoid">
          <h2 className="text-[10pt] font-semibold">The examining clinician</h2>
          <table className="mt-1 w-full text-[9.5pt]">
            <tbody className="[&_td]:py-1 [&_td]:align-top [&_th]:w-40 [&_th]:py-1 [&_th]:text-left [&_th]:font-normal [&_th]:text-neutral-500">
              <tr>
                <th>Conclusion</th>
                <td>
                  {record.doctorDecision && record.doctorDecision !== "Pending"
                    ? record.doctorDecision
                    : "Not yet recorded"}
                  {record.decidedAt &&
                    record.doctorDecision !== "Pending" &&
                    ` — ${formatDate(record.decidedAt.slice(0, 10))}`}
                </td>
              </tr>
              {(["Right", "Left"] as const).map((side) => {
                const stage = record.stages?.[side];
                const finding = record.findings?.[side];
                const said = [
                  stage !== undefined && stage !== null ? `stage ${stage}` : null,
                  finding?.zone ? `zone ${finding.zone}` : null,
                  finding?.plus ? `plus ${finding.plus}` : null,
                ].filter(Boolean);
                if (said.length === 0) return null;
                return (
                  <tr key={side}>
                    <th>{side} eye</th>
                    <td className="capitalize">{said.join(" · ")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {snapshot && (
        // the caption is already printed along the bottom of the picture
        <img
          src={snapshot}
          alt={snapshotCaption}
          className="mt-4 w-full break-inside-avoid"
        />
      )}

      {measurements.length > 0 && (
        <section className="mt-4 break-inside-avoid">
          <h2 className="text-[10pt] font-semibold">
            Measurements on this photograph
          </h2>
          <ul className="mt-1 text-[9.5pt]">
            {measurements.map((m, i) => (
              <li key={m.id}>
                {measurementName(measurements, i)}:{" "}
                {m.kind === "ruler"
                  ? pxAndDd(distance(m.a, m.b), scale)
                  : `${angleAt(m.a, m.b, m.c).toFixed(1)}°`}
              </li>
            ))}
          </ul>
        </section>
      )}

      {session.summary.eyes.map((eye) => (
        <EyeSection key={eye.eye} eye={eye} session={session} />
      ))}

      {session.summary.provisional_note && (
        <p className="mt-6 border-t border-neutral-300 pt-2 text-[8pt] leading-snug text-neutral-600">
          {session.summary.provisional_note}
        </p>
      )}
    </div>
  );
}

function EyeSection({ eye, session }: { eye: WsEye; session: WsSession }) {
  const index = eye.plus?.index;
  const rule = eye.plus?.quadrant_rule;
  const single = photoCount(eye) < 2;
  // `eyeLabel` hands back a plain string; the record is keyed by the two sides.
  const side = eyeLabel(eye.eye) as "Left" | "Right";
  const stage = session.record?.stages?.[side];

  return (
    <section className="mt-5 break-inside-avoid border-t border-neutral-300 pt-3">
      <h2 className="text-[12pt] font-semibold">
        {side} eye — what the analyser measured
      </h2>
      <table className="mt-2 w-full text-[9.5pt]">
        <tbody className="[&_td]:py-1 [&_td]:align-top [&_th]:w-40 [&_th]:py-1 [&_th]:text-left [&_th]:font-normal [&_th]:text-neutral-500">
          {session.screened && eye.severity && (
            <tr>
              <th>Assessment</th>
              <td>
                {SEVERITY_LABEL[eye.severity as Severity] ?? eye.severity}
                {eye.action ? ` — ${eye.action}` : ""}
              </td>
            </tr>
          )}
          <tr>
            <th>Plus score</th>
            <td>
              {index?.assessable && typeof index.score === "number"
                ? `${index.score.toFixed(3)} (pre-plus from ${index.cut_preplus}, plus from ${index.cut_plus})`
                : (index?.reason ?? "not computed")}
              {single && " — based on 1 photograph, less reliable"}
            </td>
          </tr>
          <tr>
            <th>Quadrant rule</th>
            <td>
              {rule?.n_quadrants_measured
                ? `${rule.n_abnormal_quadrants ?? 0} of ${rule.n_quadrants_measured} quadrants abnormal`
                : "needs an optic disc"}
              {eye.plus?.quadrants && (
                <span className="block text-neutral-600">
                  {QUADRANTS.map((q) => {
                    const v = eye.plus?.quadrants?.[q];
                    return v?.measured
                      ? `${q} ${v.abnormal ? "abnormal" : "normal"} (CTI ${fmt(v.cti, 3)}, ${fmt(v.diameter_p90, 1)} px)`
                      : `${q} not measured`;
                  }).join(" · ")}
                </span>
              )}
            </td>
          </tr>
          <tr>
            <th>Zone</th>
            <td>
              {single
                ? "Needs 2–5 photographs of this eye."
                : eye.zone?.assessable
                  ? `Zone ${eye.zone.most_posterior_zone} (verified)`
                  : eye.zone?.suggested?.zone
                    ? `Zone ${eye.zone.suggested.zone} — suggestion, not measured. ${eye.zone.suggested.caveat ?? ""}`
                    : `Not assessable${eye.zone?.reason ? ` — ${eye.zone.reason}` : ""}`}
            </td>
          </tr>
          <tr>
            <th>Stage</th>
            <td>
              {stage !== undefined && stage !== null
                ? `Stage ${stage} — entered by the examining clinician`
                : "Not measured by the analyser, and not recorded by the examiner"}
            </td>
          </tr>
          <tr>
            <th>Photographs</th>
            <td>
              {photoCount(eye)} measured
              {eye.level_meaning ? ` — ${eye.level_meaning}` : ""}
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}
