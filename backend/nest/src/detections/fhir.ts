import type { Detection, EyeAnalysis } from './detection.entity';
import type { Patient } from '../patients/patient.entity';
import { eyesFor, type Eye, type PlusGrade, type Severity } from './rop';

/**
 * The screening as an HL7 FHIR R4 bundle.
 *
 * A hospital does not want our JSON. It wants resources it can file against a
 * patient record, and FHIR is what every system in the building already
 * speaks. This turns one screening into a `DiagnosticReport` with an
 * `Observation` for each thing that was — or was not — measured.
 *
 * **On terminology.** The codes below live under this project's own URL, not
 * under LOINC or SNOMED. That is deliberate: inventing plausible-looking LOINC
 * numbers would produce a bundle that validates structurally and means nothing
 * to a receiving system, which is worse than a local code that is honestly
 * labelled. Every coding carries `display` text, so mapping to a hospital's
 * own terminology is a lookup table, and it is the integration step where it
 * belongs.
 *
 * **On absence.** FHIR has a first-class way of saying a value is missing and
 * why — `dataAbsentReason` — and this pipeline's central rule is that "could
 * not check" must never be exported as "checked and clear". So an eye whose
 * zone was not assessable comes out as an Observation with no value and a
 * reason, not as a missing Observation and not as a normal one. Anything
 * reading this bundle inherits that distinction instead of having to be told.
 */

const SYSTEM = 'https://medcity.rop/fhir/CodeSystem/rop';
const ABSENT = 'http://terminology.hl7.org/CodeSystem/data-absent-reason';
const OBS_CATEGORY =
  'http://terminology.hl7.org/CodeSystem/observation-category';

interface Coding {
  system: string;
  code: string;
  display: string;
}

interface CodeableConcept {
  coding?: Coding[];
  text?: string;
}

interface FhirResource {
  resourceType: string;
  id: string;
  [key: string]: unknown;
}

export interface FhirBundle {
  resourceType: 'Bundle';
  id: string;
  type: 'collection';
  timestamp: string;
  entry: { fullUrl: string; resource: FhirResource }[];
}

/** What the analyser and the examiner each said about one eye. */
export interface EyeFindings {
  severity?: Severity | null;
  plus?: PlusGrade | null;
  plusAssessable?: boolean;
  zone?: string | null;
  zoneAssessable?: boolean;
  /** The examining clinician's stage. The analyser never writes here. */
  stage?: number | null;
}

function concept(code: string, display: string): CodeableConcept {
  return { coding: [{ system: SYSTEM, code, display }], text: display };
}

function absent(code: 'not-performed' | 'unknown', why: string) {
  return {
    dataAbsentReason: {
      coding: [{ system: ABSENT, code, display: why }],
      text: why,
    },
  };
}

/**
 * Which eye an observation is about.
 *
 * Laterality is the field a receiving system most needs and most often loses.
 * It is carried on every eye-level observation rather than implied by the
 * order the observations appear in.
 */
function bodySite(eye: Eye): CodeableConcept {
  return concept(
    eye === 'Left' ? 'eye-left' : 'eye-right',
    `${eye} eye`,
  );
}

const CATEGORY: CodeableConcept = {
  coding: [{ system: OBS_CATEGORY, code: 'imaging', display: 'Imaging' }],
};

/** Reads the per-eye findings out of the assessment the Python service wrote. */
export function findingsFromSummary(
  detection: Detection,
): Partial<Record<Eye, EyeFindings>> {
  const out: Partial<Record<Eye, EyeFindings>> = {};
  const summary = detection.phase2Summary as
    | { eyes?: unknown[] }
    | null
    | undefined;

  for (const eye of eyesFor(detection.eye)) {
    out[eye] = {
      stage: detection.icropStages?.[eye] ?? null,
    };
  }

  for (const raw of summary?.eyes ?? []) {
    const block = raw as {
      eye?: string;
      severity?: Severity;
      icrop?: {
        zone?: { value?: string | null; source?: string };
        plus?: { value?: string | null };
      };
      zone?: { assessable?: boolean };
      plus?: { assessable?: boolean };
    };
    const eye: Eye | null =
      block.eye === 'L' ? 'Left' : block.eye === 'R' ? 'Right' : null;
    if (!eye) continue;

    out[eye] = {
      ...out[eye],
      severity: block.severity ?? null,
      zone: block.icrop?.zone?.value ?? null,
      zoneAssessable: Boolean(block.zone?.assessable),
      plus: (block.icrop?.plus?.value as PlusGrade | undefined) ?? null,
      plusAssessable: Boolean(block.plus?.assessable),
    };
  }

  return out;
}

const SEVERITY_DISPLAY: Record<Severity, string> = {
  lower: 'Lower severity — supervision',
  intermediate: 'Intermediate severity — close supervision and treatment',
  severe: 'Severe — treat within 24 to 48 hours',
  unknown: 'Not gradable — severe disease is NOT excluded',
};

export function buildFhirBundle(
  detection: Detection,
  patient: Patient | null,
  author: { id: string; name: string },
): FhirBundle {
  const now = new Date().toISOString();
  const patientRef = `urn:uuid:patient-${detection.patientId}`;
  const entry: { fullUrl: string; resource: FhirResource }[] = [];
  const observationRefs: { reference: string }[] = [];

  const push = (resource: FhirResource, fullUrl: string) => {
    entry.push({ fullUrl, resource });
  };

  // ------------------------------------------------------------- patient
  push(
    {
      resourceType: 'Patient',
      id: detection.patientId,
      identifier: [
        { system: 'https://medcity.rop/patient', value: detection.patientId },
      ],
      name: patient
        ? [{ family: patient.lastName, given: [patient.firstName] }]
        : [{ text: detection.patientName }],
      gender:
        patient?.gender?.toLowerCase() === 'male'
          ? 'male'
          : patient?.gender?.toLowerCase() === 'female'
            ? 'female'
            : 'unknown',
      birthDate: patient?.dateOfBirth ?? undefined,
    },
    patientRef,
  );

  const observe = (
    id: string,
    code: CodeableConcept,
    eye: Eye | null,
    value: Record<string, unknown>,
    notes?: string[],
  ) => {
    const fullUrl = `urn:uuid:obs-${detection.id}-${id}`;
    push(
      {
        resourceType: 'Observation',
        id: `${detection.id}-${id}`,
        status: 'final',
        category: [CATEGORY],
        code,
        subject: { reference: patientRef },
        effectiveDateTime: detection.date,
        issued: now,
        ...(eye ? { bodySite: bodySite(eye) } : {}),
        ...value,
        ...(notes?.length ? { note: notes.map((text) => ({ text })) } : {}),
      },
      fullUrl,
    );
    observationRefs.push({ reference: fullUrl });
  };

  // ------------------------------------------- Phase 1, one risk per eye
  for (const analysis of (detection.eyeResults ?? []) as EyeAnalysis[]) {
    observe(
      `risk-${analysis.eye.toLowerCase()}`,
      concept('rop-risk', 'Estimated risk of retinopathy of prematurity'),
      analysis.eye,
      {
        valueQuantity: {
          value: Number((analysis.risk * 100).toFixed(1)),
          unit: '%',
          system: 'http://unitsofmeasure.org',
          code: '%',
        },
        interpretation: [
          analysis.flagged
            ? concept('flagged', 'At or above the referral threshold')
            : concept('not-flagged', 'Below the referral threshold'),
        ],
      },
      [
        analysis.threshold !== undefined
          ? `Referral threshold in force at the time: ${(analysis.threshold * 100).toFixed(1)}%.`
          : 'Referral threshold was not recorded with this result.',
        'Screening estimate from a machine learning model. It is not a diagnosis.',
      ],
    );
  }

  // ------------------------------- Phase 2, what was and was not measured
  const findings = findingsFromSummary(detection);

  for (const eye of eyesFor(detection.eye)) {
    const f = findings[eye];
    if (!f) continue;
    const low = eye.toLowerCase();

    if (f.severity) {
      observe(
        `severity-${low}`,
        concept('rop-severity', 'Measured severity and urgency'),
        eye,
        { valueCodeableConcept: concept(f.severity, SEVERITY_DISPLAY[f.severity]) },
      );
    }

    // Plus disease. Absent means "could not be assessed", which is a result.
    observe(
      `plus-${low}`,
      concept('rop-plus', 'Plus disease'),
      eye,
      f.plus && f.plusAssessable
        ? { valueCodeableConcept: concept(f.plus, `Plus disease: ${f.plus}`) }
        : absent(
            'unknown',
            'Plus disease could not be assessed from these photographs',
          ),
      ['Measured by the vessel pipeline. Thresholds are provisional.'],
    );

    // Zone. The same rule, and the one it matters most for.
    observe(
      `zone-${low}`,
      concept('rop-zone', 'ICROP zone reached by the retinal vessels'),
      eye,
      f.zone && f.zoneAssessable
        ? { valueCodeableConcept: concept(`zone-${f.zone}`, `Zone ${f.zone}`) }
        : absent(
            'unknown',
            'The photographs did not reach the vascular front, so zone was not assessable',
          ),
      [
        'Not assessable is not the same as no Zone I disease. Severe disease is not excluded by this result.',
      ],
    );

    // Stage is the clinician's, always. The pipeline never writes it.
    observe(
      `stage-${low}`,
      concept('rop-stage', 'ICROP stage'),
      eye,
      f.stage !== null && f.stage !== undefined
        ? { valueInteger: f.stage }
        : absent('not-performed', 'Stage is recorded by the examining clinician'),
      [
        'This system does not detect the demarcation line, the ridge or neovascularisation, so it never measures stage.',
      ],
    );
  }

  // ------------------------------------------ the clinician's conclusion
  const conclusion = detection.doctorDecision ?? 'Pending';
  const decided = conclusion !== 'Pending';

  const reportRef = `urn:uuid:report-${detection.id}`;
  push(
    {
      resourceType: 'DiagnosticReport',
      id: detection.id,
      status: decided ? 'final' : 'preliminary',
      category: [CATEGORY],
      code: concept(
        'rop-screening',
        'Retinopathy of prematurity screening report',
      ),
      subject: { reference: patientRef },
      effectiveDateTime: detection.date,
      issued: now,
      performer: [{ display: author.name }],
      result: observationRefs,
      conclusion: decided
        ? `Examining clinician: ${conclusion}.`
        : 'No conclusion has been recorded by the examining clinician.',
      conclusionCode: decided
        ? [concept(conclusion.toLowerCase().replace(/\s+/g, '-'), conclusion)]
        : undefined,
      note: [
        {
          text:
            'Research prototype. Decision support only, not validated for ' +
            'clinical use. The diagnosis is the examining clinician’s. Codes ' +
            'in this bundle are local to this system; map them to the ' +
            'receiving terminology before filing.',
        },
        ...(detection.notes ? [{ text: detection.notes }] : []),
      ],
    },
    reportRef,
  );

  return {
    resourceType: 'Bundle',
    id: `rop-${detection.id}`,
    type: 'collection',
    timestamp: now,
    entry,
  };
}
