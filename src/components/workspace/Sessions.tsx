import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { ApiError, errorMessage } from "@/lib/api";
import { getDetectionById, type Detection } from "@/lib/detections";
import { formatDate } from "@/lib/format";
import { getPatientById, type Patient } from "@/lib/patients";
import {
  getDetectionPacket,
  getJobPacket,
  getSeverity,
  getSeverityJob,
  startSeverity,
  type SeverityState,
} from "@/lib/severity";
import { eyeLabel, type WsPacket, type WsSession, type WsSummary } from "@/lib/workspace";
import { MessageStage, ProgressStage, pillClass } from "./Stage";
import type { WorkspaceNav } from "./state";
import Workspace from "./Workspace";

const POLL_MS = 3000;

function eyesText(summary: WsSummary): string {
  const names = summary.eyes.map((e) => eyeLabel(e.eye));
  return `${names.join(" and ")} eye${names.length > 1 ? "s" : ""}`;
}

/**
 * A saved examination in the Workspace.
 *
 * Measured already: it opens at once. Not measured: the doctor can run it from
 * the canvas, through the same route the detection page uses, and the result is
 * saved to that examination.
 */
export function DetectionSession({ id, nav }: { id: string; nav: WorkspaceNav }) {
  const [detection, setDetection] = useState<Detection | null>(null);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [state, setState] = useState<SeverityState | null>(null);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setState(await getSeverity(id));
      setError("");
    } catch (e) {
      setError(errorMessage(e, "Could not reach the vessel analyser."));
    }
  }, [id]);

  useEffect(() => {
    getDetectionById(id)
      .then((found) => {
        if (!found) {
          setError("This examination does not exist.");
          return;
        }
        setDetection(found);
        // For the printed page: date of birth and gestational age identify the
        // baby, and a report filed without them is hard to match to a chart.
        void getPatientById(found.patientId)
          .then((record) => setPatient(record ?? null))
          .catch(() => setPatient(null));
      })
      .catch((e) => setError(errorMessage(e, "Could not load this examination.")));
    void refresh();
  }, [id, refresh]);

  const running = state?.status === "queued" || state?.status === "running";
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [running, refresh]);

  const fetchPacket = useCallback(
    (key: string) => getDetectionPacket(id, key) as unknown as Promise<WsPacket>,
    [id],
  );

  async function run() {
    setStarting(true);
    setError("");
    try {
      await startSeverity(id);
      await refresh();
    } catch (e) {
      setError(errorMessage(e, "The vessel analysis could not be started."));
    } finally {
      setStarting(false);
    }
  }

  if (state?.status === "done" && state.summary && detection) {
    const summary = state.summary as unknown as WsSummary;
    const session: WsSession = {
      source: { kind: "detection", detectionId: id },
      title: detection.patientName,
      subtitle: `${formatDate(detection.date)} · ${eyesText(summary)}`,
      screened: true,
      summary,
      record: {
        patientId: detection.patientId,
        dateOfBirth: patient?.dateOfBirth,
        gestationalAge: patient?.gestationalAge,
        examinedOn: detection.date,
        doctorDecision: detection.doctorDecision,
        decidedAt: detection.decidedAt,
        stages: state.icropStages,
        findings: state.examinerFindings,
      },
    };
    return <Workspace session={session} fetchPacket={fetchPacket} nav={nav} />;
  }

  let stage;
  if (running) {
    stage = (
      <ProgressStage
        step={state?.step ?? null}
        progress={state?.progress ?? null}
        seconds={state?.seconds ?? null}
      />
    );
  } else if (!state && !error) {
    stage = <MessageStage busy title="Opening the examination" />;
  } else {
    const failed = state?.status === "failed";
    stage = (
      <MessageStage
        title={failed ? "The last vessel analysis did not finish" : "No vessel analysis yet"}
        actions={
          state && (
            <button onClick={() => void run()} disabled={starting} className={pillClass}>
              {starting && <Loader2 className="size-4 animate-spin" />}
              {failed ? "Try again" : "Run vessel analysis"}
            </button>
          )
        }
      >
        {detection && (
          <p className="text-ink/85">
            {detection.patientName} · {formatDate(detection.date)}
          </p>
        )}
        <p className="mt-1">
          {failed
            ? (state?.error ?? "No reason was reported.")
            : "About a minute for two eyes. The result is saved to this examination."}
        </p>
        {error && <p className="mt-2 text-amber-200/90">{error}</p>}
      </MessageStage>
    );
  }
  return <Workspace session={null} stage={stage} nav={nav} />;
}

/**
 * Imported images in the Workspace.
 *
 * The job lives in the analyser's memory. Nothing is saved, so when the
 * analyser restarts the import is gone — which is said plainly rather than
 * shown as an error to retry.
 */
export function JobSession({
  jobId,
  patientId,
  nav,
}: {
  jobId: string;
  patientId: string | null;
  nav: WorkspaceNav;
}) {
  const [state, setState] = useState<Awaited<ReturnType<typeof getSeverityJob>> | null>(null);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [error, setError] = useState<{ message: string; expired: boolean } | null>(null);

  useEffect(() => {
    if (!patientId) return;
    getPatientById(patientId)
      .then((found) => setPatient(found ?? null))
      .catch(() => setPatient(null));
  }, [patientId]);

  const finished = state?.status === "done" || state?.status === "failed";
  useEffect(() => {
    if (finished) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const next = await getSeverityJob(jobId);
        if (!cancelled) {
          setState(next);
          setError(null);
        }
      } catch (e) {
        if (cancelled) return;
        const expired = e instanceof ApiError && (e.status === 400 || e.status === 404);
        setError({ message: errorMessage(e, "Could not reach the vessel analyser."), expired });
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [jobId, finished]);

  const fetchPacket = useCallback(
    (key: string) => getJobPacket(jobId, key) as unknown as Promise<WsPacket>,
    [jobId],
  );

  if (state?.status === "done" && state.summary && !error?.expired) {
    const summary = state.summary as unknown as WsSummary;
    const photos = summary.eyes.reduce((n, e) => n + (e.evidence.photos?.length ?? 0), 0);
    const session: WsSession = {
      source: { kind: "import", jobId },
      title: patient ? `${patient.firstName} ${patient.lastName}` : "Anonymous",
      subtitle: `${eyesText(summary)} · ${photos} photograph${photos === 1 ? "" : "s"} · not saved`,
      screened: false,
      summary,
    };
    return <Workspace session={session} fetchPacket={fetchPacket} nav={nav} />;
  }

  const importAgain = (
    <button onClick={nav.onImportImages} className={pillClass}>
      Import again
    </button>
  );

  let stage;
  if (error?.expired) {
    stage = (
      <MessageStage title="This import has expired" actions={importAgain}>
        Imports are not saved, and the analyser no longer holds this one — it may have been
        restarted.
      </MessageStage>
    );
  } else if (state?.status === "failed") {
    stage = (
      <MessageStage title="The measurement did not finish" actions={importAgain}>
        {state.error ?? "No reason was reported."}
      </MessageStage>
    );
  } else {
    stage = (
      <ProgressStage
        step={error ? `${error.message} Still trying…` : (state?.step ?? null)}
        progress={state?.progress ?? null}
        seconds={state?.seconds ?? null}
      />
    );
  }
  return <Workspace session={null} stage={stage} nav={nav} />;
}
