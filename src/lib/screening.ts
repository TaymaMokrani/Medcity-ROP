import type { Detection, DoctorDecision } from "./detections";
import { TONE, type Tone } from "@/components/ui/tone";

/**
 * What a screening concluded, and what that makes of the patient.
 *
 * The model's flag used to be the whole answer. It meant a baby the doctor had
 * examined and marked "Confirms ROP" could sit in the list as Clear, and a baby
 * they had cleared stayed Flagged for good. The model is decision support; the
 * doctor's entry is the diagnosis. So the decision wins wherever one has been
 * recorded, and the flag only speaks while the decision is still Pending.
 *
 * Where the two disagree, both are kept: the state says what the doctor
 * decided, `disputed` says the model saw it differently, and no screen quietly
 * drops one of them.
 */

export type PatientState = "Flagged" | "Uncertain" | "Clear" | "Not screened";

/** Who the state came from. Printed next to it wherever there is room. */
export type StateSource = "doctor" | "model";

export interface ScreeningVerdict {
  state: Exclude<PatientState, "Not screened">;
  source: StateSource;
  /** True when the doctor and the model reached different answers. */
  disputed: boolean;
}

/** One screening, resolved. */
export function verdictFor(detection: Detection): ScreeningVerdict {
  const decision: DoctorDecision = detection.doctorDecision ?? "Pending";
  const flagged = Boolean(detection.flagged);

  if (decision === "Confirms ROP") {
    return { state: "Flagged", source: "doctor", disputed: !flagged };
  }
  if (decision === "No ROP") {
    return { state: "Clear", source: "doctor", disputed: flagged };
  }
  if (decision === "Uncertain") {
    // Not a mild answer. An eye the examiner could not call is not a clear eye.
    return { state: "Uncertain", source: "doctor", disputed: false };
  }
  return {
    state: flagged ? "Flagged" : "Clear",
    source: "model",
    disputed: false,
  };
}

export interface ScreeningSummary {
  state: PatientState;
  source: StateSource | null;
  /** Any screening where the doctor and the model disagreed. */
  disputed: boolean;
  screenings: number;
  /** Screenings still waiting for the doctor's conclusion. */
  pending: number;
  lastScreening: string | null;
  highestRisk: number | null;
}

export const NOT_SCREENED: ScreeningSummary = {
  state: "Not screened",
  source: null,
  disputed: false,
  screenings: 0,
  pending: 0,
  lastScreening: null,
  highestRisk: null,
};

/** Worst first: a patient is as flagged as their worst screening. */
export const STATE_ORDER: PatientState[] = [
  "Flagged",
  "Uncertain",
  "Clear",
  "Not screened",
];

export function stateRank(state: PatientState): number {
  return STATE_ORDER.indexOf(state);
}

function worse(a: PatientState, b: PatientState): PatientState {
  return stateRank(b) < stateRank(a) ? b : a;
}

export function summariseByPatient(
  detections: Detection[],
): Map<string, ScreeningSummary> {
  const summaries = new Map<string, ScreeningSummary>();

  for (const detection of detections) {
    const previous = summaries.get(detection.patientId) ?? NOT_SCREENED;
    const verdict = verdictFor(detection);
    const risk = typeof detection.risk === "number" ? detection.risk : null;
    const state = worse(previous.state, verdict.state);

    summaries.set(detection.patientId, {
      state,
      // the source of the state now showing, not of the last screening read
      source: state === verdict.state ? verdict.source : previous.source,
      disputed: previous.disputed || verdict.disputed,
      screenings: previous.screenings + 1,
      pending:
        previous.pending +
        ((detection.doctorDecision ?? "Pending") === "Pending" ? 1 : 0),
      lastScreening:
        !previous.lastScreening || detection.date > previous.lastScreening
          ? detection.date
          : previous.lastScreening,
      highestRisk:
        risk !== null && (previous.highestRisk === null || risk > previous.highestRisk)
          ? risk
          : previous.highestRisk,
    });
  }

  return summaries;
}

export function summaryFor(
  summaries: Map<string, ScreeningSummary>,
  patientId: string,
): ScreeningSummary {
  return summaries.get(patientId) ?? NOT_SCREENED;
}

/** The colour a state is allowed to take. Nothing else decides this. */
export const STATE_TONE: Record<PatientState, Tone> = {
  Flagged: "urgent",
  Uncertain: "watch",
  Clear: "steady",
  "Not screened": "neutral",
};

export function stateTone(state: PatientState): Tone {
  return STATE_TONE[state];
}

/**
 * The old badge shape, in the new colours.
 *
 * Here so the screens that have not been restyled yet keep working and already
 * read from the tokens. It goes when the last of them moves to `<Chip>`.
 */
export function stateBadge(state: PatientState) {
  const { wash, text, border, dot } = TONE[STATE_TONE[state]];
  return { bg: wash, text, border, dot };
}
