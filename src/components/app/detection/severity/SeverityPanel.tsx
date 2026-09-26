import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "@/lib/api";
import type { Detection } from "@/lib/detections";
import { getSeverity, startSeverity, type SeverityState } from "@/lib/severity";
import { Note } from "@/components/app/ui/clinical";
import { buttonClass, primaryButtonClass } from "@/components/app/ui/tone";
import SeverityProgress from "./SeverityProgress";
import SeverityResults from "./SeverityResults";

/** How often to ask how the analysis is getting on. It takes about a minute. */
const POLL_MS = 4000;

/**
 * Phase 2 on a stored screening.
 *
 * Most screenings arrive here already measured, because the doctor runs the
 * analysis before saving. This is the path back to it — and the way to run it on
 * a screening saved before the analysis existed, or one whose analysis failed.
 *
 * Phase 2 follows Phase 1. It measures how severe ROP is, which is only a
 * question once Phase 1 has found ROP to measure, so on a screening where no
 * eye was flagged this offers nothing and says why. It does not refuse: a
 * doctor who wants the measurements on a clear eye can still ask for them.
 * The model's flag is not the diagnosis, and a button is not the place to
 * argue about that.
 */
export default function SeverityPanel({ detection }: { detection: Detection }) {
  const [state, setState] = useState<SeverityState | null>(null);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const timer = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      setState(await getSeverity(detection.id));
      setError("");
    } catch (e) {
      setError(errorMessage(e, "Could not reach the severity analyser."));
    }
  }, [detection.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const running = state?.status === "queued" || state?.status === "running";
    if (!running) return;

    timer.current = window.setInterval(() => void refresh(), POLL_MS);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [state?.status, refresh]);

  async function run() {
    setStarting(true);
    setError("");
    try {
      await startSeverity(detection.id);
      await refresh();
    } catch (e) {
      setError(errorMessage(e, "Could not start the severity analysis."));
    } finally {
      setStarting(false);
    }
  }

  const status = state?.status ?? "none";
  const summary = state?.summary ?? null;

  const perEye = detection.eyeResults ?? [];
  const flagged = perEye.length
    ? perEye.filter((eye) => eye.flagged)
    : detection.flagged
      ? [{ eye: detection.eye }]
      : [];

  return (
    <section>
      <h2 className="font-heading text-display leading-none text-ink">
        Overall severity assessment
      </h2>

      {error && (
        <p className="mt-5 border-l-2 border-urgent pl-4 text-body text-urgent">
          {error}
        </p>
      )}

      {status === "none" && flagged.length === 0 && (
        <div className="mt-6">
          <Note>
            No eye was flagged by the screening model, so severity was not
            measured. It grades how advanced ROP is, which only follows once
            there is ROP to grade.
          </Note>
          <button
            onClick={() => void run()}
            disabled={starting}
            className={`${buttonClass} mt-4`}
          >
            {starting ? "Starting…" : "Measure anyway"}
          </button>
        </div>
      )}

      {status === "none" && flagged.length > 0 && (
        <div className="mt-6">
          <Note>
            {flagged.length === 1 && "eye" in flagged[0]
              ? `The ${String(flagged[0].eye).toLowerCase()} eye was flagged. Measure how severe it is.`
              : "Both eyes were flagged. Measure how severe they are."}{" "}
            It takes about a minute for two eyes.
          </Note>
          <button
            onClick={() => void run()}
            disabled={starting}
            className={`${primaryButtonClass} mt-4`}
          >
            {starting ? "Starting…" : "Analyse severity"}
          </button>
        </div>
      )}

      {(status === "queued" || status === "running") && (
        <div className="mt-6">
          <SeverityProgress
            step={state?.step ?? null}
            progress={state?.progress ?? null}
            seconds={state?.seconds ?? null}
          />
        </div>
      )}

      {status === "failed" && (
        <div className="mt-6 border-l-2 border-urgent pl-4">
          <p className="text-body text-urgent">The analysis did not finish</p>
          <p className="mt-1.5 max-w-prose text-label leading-relaxed text-ink-3">
            {state?.error ?? "No reason was reported."}
          </p>
          <button
            onClick={() => void run()}
            disabled={starting}
            className={`${buttonClass} mt-4`}
          >
            Try again
          </button>
        </div>
      )}

      {status === "done" && summary && (
        <SeverityResults summary={summary} detectionId={detection.id} />
      )}
    </section>
  );
}
