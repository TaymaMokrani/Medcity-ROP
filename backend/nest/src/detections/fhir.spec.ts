import { buildFhirBundle } from './fhir';
import type { Detection } from './detection.entity';
import type { Patient } from '../patients/patient.entity';

/**
 * The export has one job beyond being valid FHIR: it must not launder a
 * refusal into a reassurance.
 *
 * Inside this system, "zone could not be assessed" and "zone is normal" are
 * kept apart everywhere — in the pipeline, in the record and on the screen. A
 * bundle that dropped the distinction on the way out would undo all of it at
 * the last step, in the one place nobody would look. Most of what is checked
 * below is that distinction surviving.
 */

const AUTHOR = { id: 'doc-1', name: 'Dr Tayma Mokrani' };

function detection(overrides: Partial<Detection> = {}): Detection {
  return {
    id: 'DET-1',
    ownerId: 'doc-1',
    patientId: 'PAT-1',
    patientName: 'Mehdi Bouazizi',
    date: '2026-09-20',
    risk: 0.98,
    flagged: true,
    eye: 'Both',
    image: '',
    images: [],
    eyeResults: [
      { eye: 'Left', risk: 0.98, flagged: true, threshold: 0.18, images: [] },
      { eye: 'Right', risk: 0.11, flagged: false, threshold: 0.18, images: [] },
    ],
    notes: '',
    doctorDecision: 'Confirms ROP',
    decidedAt: new Date('2026-09-20T10:00:00.000Z'),
    createdAt: new Date('2026-09-20T09:00:00.000Z'),
    modelVersion: 'v1-2026-08',
    phase2Status: 'done',
    phase2JobId: 'job-1',
    phase2Error: null,
    phase2At: new Date('2026-09-20T10:05:00.000Z'),
    phase2Version: 'v1-2026-09',
    severity: 'severe',
    severityUrgent: true,
    phase2Summary: null,
    phase2Evidence: null,
    icropStages: {},
    examinerFindings: {},
    ...overrides,
  } as Detection;
}

const patient = {
  id: 'PAT-1',
  firstName: 'Mehdi',
  lastName: 'Bouazizi',
  dateOfBirth: '2026-09-05',
  gender: 'Male',
  gestationalAge: 27,
  birthWeight: 940,
} as Patient;

/** An assessment shaped the way the Python service writes it. */
function summary(left: Record<string, unknown>) {
  return {
    eyes: [
      {
        eye: 'L',
        severity: 'severe',
        zone: { assessable: false },
        plus: { assessable: true },
        icrop: {
          zone: { value: null, source: 'measured' },
          plus: { value: 'plus' },
        },
        ...left,
      },
    ],
  } as unknown as Record<string, unknown>;
}

function resources(bundle: ReturnType<typeof buildFhirBundle>) {
  return bundle.entry.map((e) => e.resource);
}

function observation(
  bundle: ReturnType<typeof buildFhirBundle>,
  id: string,
): Record<string, unknown> | undefined {
  return resources(bundle).find(
    (r) => r.resourceType === 'Observation' && r.id === id,
  ) as Record<string, unknown> | undefined;
}

describe('FHIR export', () => {
  it('produces a collection bundle with the patient and the report', () => {
    const bundle = buildFhirBundle(detection(), patient, AUTHOR);

    expect(bundle.resourceType).toBe('Bundle');
    expect(bundle.type).toBe('collection');
    expect(
      resources(bundle).filter((r) => r.resourceType === 'Patient'),
    ).toHaveLength(1);
    expect(
      resources(bundle).filter((r) => r.resourceType === 'DiagnosticReport'),
    ).toHaveLength(1);
  });

  it('gives every observation a subject, a date and a laterality', () => {
    const bundle = buildFhirBundle(
      detection({ phase2Summary: summary({}) }),
      patient,
      AUTHOR,
    );

    const observations = resources(bundle).filter(
      (r) => r.resourceType === 'Observation',
    );
    expect(observations.length).toBeGreaterThan(0);

    for (const obs of observations) {
      expect(obs.subject).toEqual({ reference: 'urn:uuid:patient-PAT-1' });
      expect(obs.effectiveDateTime).toBe('2026-09-20');
      // Every finding in this system is about one eye. None may lose that.
      expect(obs.bodySite).toBeDefined();
    }
  });

  it('carries each eye’s risk as a percentage with the threshold it was judged against', () => {
    const bundle = buildFhirBundle(detection(), patient, AUTHOR);

    const left = observation(bundle, 'DET-1-risk-left');
    expect(left?.valueQuantity).toEqual({
      value: 98,
      unit: '%',
      system: 'http://unitsofmeasure.org',
      code: '%',
    });
    expect(JSON.stringify(left?.note)).toContain('18.0%');

    const right = observation(bundle, 'DET-1-risk-right');
    expect(JSON.stringify(right?.interpretation)).toContain(
      'Below the referral',
    );
  });

  it('exports an unassessable zone as absent with a reason, never as normal', () => {
    const bundle = buildFhirBundle(
      detection({ phase2Summary: summary({}) }),
      patient,
      AUTHOR,
    );

    const zone = observation(bundle, 'DET-1-zone-left');
    expect(zone).toBeDefined();
    // The observation exists. It just has no value — which is the finding.
    expect(zone?.valueCodeableConcept).toBeUndefined();
    expect(JSON.stringify(zone?.dataAbsentReason)).toContain(
      'data-absent-reason',
    );
    expect(JSON.stringify(zone?.note)).toContain('not excluded');
  });

  it('exports a measured zone as a value', () => {
    const bundle = buildFhirBundle(
      detection({
        phase2Summary: summary({
          zone: { assessable: true },
          icrop: { zone: { value: 'II' }, plus: { value: 'plus' } },
        }),
      }),
      patient,
      AUTHOR,
    );

    const zone = observation(bundle, 'DET-1-zone-left');
    expect(JSON.stringify(zone?.valueCodeableConcept)).toContain('Zone II');
    expect(zone?.dataAbsentReason).toBeUndefined();
  });

  it('never exports a stage the analyser did not measure', () => {
    const bundle = buildFhirBundle(
      detection({ phase2Summary: summary({}) }),
      patient,
      AUTHOR,
    );

    const stage = observation(bundle, 'DET-1-stage-left');
    expect(stage?.valueInteger).toBeUndefined();
    expect(JSON.stringify(stage?.dataAbsentReason)).toContain('not-performed');
  });

  it('exports the stage the examining clinician entered', () => {
    const bundle = buildFhirBundle(
      detection({ phase2Summary: summary({}), icropStages: { Left: 3 } }),
      patient,
      AUTHOR,
    );

    expect(observation(bundle, 'DET-1-stage-left')?.valueInteger).toBe(3);
  });

  it('is preliminary until the clinician has concluded', () => {
    const pending = buildFhirBundle(
      detection({ doctorDecision: 'Pending' }),
      patient,
      AUTHOR,
    );
    const report = resources(pending).find(
      (r) => r.resourceType === 'DiagnosticReport',
    );
    expect(report?.status).toBe('preliminary');
    expect(report?.conclusionCode).toBeUndefined();

    const concluded = buildFhirBundle(detection(), patient, AUTHOR);
    const final = resources(concluded).find(
      (r) => r.resourceType === 'DiagnosticReport',
    );
    expect(final?.status).toBe('final');
    expect(JSON.stringify(final?.conclusion)).toContain('Confirms ROP');
  });

  it('says in the bundle that the codes are local and the tool is a prototype', () => {
    const bundle = buildFhirBundle(detection(), patient, AUTHOR);
    const report = resources(bundle).find(
      (r) => r.resourceType === 'DiagnosticReport',
    );
    const text = JSON.stringify(report?.note);
    expect(text).toContain('Research prototype');
    expect(text).toContain('local to this system');
  });

  it('still exports when the patient record is gone', () => {
    const bundle = buildFhirBundle(detection(), null, AUTHOR);
    const subject = resources(bundle).find((r) => r.resourceType === 'Patient');
    expect(JSON.stringify(subject?.name)).toContain('Mehdi Bouazizi');
    expect(subject?.birthDate).toBeUndefined();
  });

  it('points the report at every observation it produced', () => {
    const bundle = buildFhirBundle(
      detection({ phase2Summary: summary({}) }),
      patient,
      AUTHOR,
    );
    const report = resources(bundle).find(
      (r) => r.resourceType === 'DiagnosticReport',
    ) as unknown as { result: { reference: string }[] };

    const ids = new Set(bundle.entry.map((e) => e.fullUrl));
    expect(report.result.length).toBeGreaterThan(0);
    for (const ref of report.result) {
      expect(ids.has(ref.reference)).toBe(true);
    }
  });
});
