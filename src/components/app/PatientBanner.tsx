import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import type { Patient } from "@/lib/patients";
import { formatPma } from "@/lib/format";
import { formatWeeks } from "@/lib/validation";

/**
 * Who this is, kept on screen.
 *
 * A screening page used to be titled "Detection Details" with a record id under
 * it, and the baby's name in a card off to the right. Every hospital system
 * that has learned this the hard way puts the patient in a strip that does not
 * scroll away, because the mistake it prevents — right data, wrong chart — is
 * the one that actually happens on a ward.
 *
 * Two lines: the name with its record number, then the three numbers a
 * screening decision turns on — how premature, how far along now, how small.
 * Date of birth and age in days were on that line too, saying the same thing
 * gestational age and PMA already say.
 */
export default function PatientBanner({
  patient,
  patientName,
  patientId,
  meta,
  actions,
  compact = false,
}: {
  /** Null while it loads, or if the record was deleted. */
  patient: Patient | null;
  /** The name carried on the screening, shown until the record arrives. */
  patientName: string;
  patientId: string;
  /** Anything specific to this screen, such as the date it was screened. */
  meta?: ReactNode;
  actions?: ReactNode;
  /**
   * Drops the second line. A screening being made has no record to describe
   * yet — the form below it is where the eyes and the date are being chosen,
   * so repeating them above would be reading them back to the doctor.
   */
  compact?: boolean;
}) {
  const name = patient
    ? `${patient.firstName} ${patient.lastName}`
    : patientName || "Unknown patient";

  return (
    <header className="sticky top-0 z-20 -mx-6 mb-8 border-b border-line bg-panel/95 px-6 py-4 backdrop-blur md:-mx-10 md:px-10">
      {/* Baseline, not centre: the record number sits on the line the name is
          written on rather than floating at the middle of it. */}
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <h1 className="font-heading text-display leading-none text-ink">
          <Link
            to={`/app/patient/${patientId}`}
            className="underline-offset-4 hover:underline"
          >
            {name}
          </Link>
        </h1>

        <span className="text-label text-ink-3 tabular-nums">{patientId}</span>

        {actions && (
          <div className="ml-auto flex items-center gap-2 self-center">{actions}</div>
        )}
      </div>

      {!compact && (
      <dl className="mt-2 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-label text-ink-3">
        {patient && (
          <>
            <Fact label="GA at birth" value={formatWeeks(patient.gestationalAge)} />
            <Fact
              label="PMA now"
              value={formatPma(patient.dateOfBirth, patient.gestationalAge)}
              hint="Postmenstrual age: gestational age at birth plus age since"
            />
            <Fact label="Birth weight" value={`${patient.birthWeight} g`} />
          </>
        )}
        {meta}
      </dl>
      )}
    </header>
  );
}

function Fact({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline gap-1.5" title={hint}>
      <dt className="text-ink-3">{label}</dt>
      <dd className="text-ink-2 tabular-nums">{value}</dd>
    </div>
  );
}
