import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "@/lib/api";
import type { EyeVerdict } from "@/lib/detections";
import {
  getSeverityJob,
  startSeverityPreview,
  type SeverityEye,
  type SeverityJobState,
} from "@/lib/severity";
import { Note } from "@/components/app/ui/clinical";
import { buttonClass, primaryButtonClass } from "@/components/app/ui/tone";
import ReferralThreshold from "./ReferralThreshold";
import SeverityProgress from "./SeverityProgress";
import SeverityResults from "./SeverityResults";

const POLL_MS = 4000;

/**
 * Severity, measured before the screening is committed.
 *
 * The doctor saves once, when they are satisfied with all of it — the risk, the
 * severity, the evidence and their own stage. So the analysis runs here, against
 * a job rather than a record, and the job id travels with the save.
 *
 * Nothing is written to the database by anything on this screen. Walking away
 * discards the analysis, which is the point.
 */
export default function SeverityStep({
  eye,
  images,
  meta,
  eyeResults,
  threshold,
  onThreshold,
  onReady,
  onRunning,
  onMeasured,
}: {
  eye: "Left" | "Right" | "Both";
  images: { left: File[]; right: File[] };
  meta: { patientId: string; date: string };
  eyeResults: Pick<EyeVerdict, "eye" | "risk" | "flagged">[];
  threshold: number;
  onThreshold: (value: number) => void;
  /** The job id to save with, or null while there is nothing to save. */
  onReady: (jobId: string | null) => void;
  /** True while the analyser is working, so the page can refuse to save. */
  onRunning?: (running: boolean) => void;
  /** The finished assessment, so the examiner's own findings can sit beside it. */
  onMeasured?: (eyes: SeverityEye[]) => void;
}) {
  const [job, setJob] = useState<SeverityJobState | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const timer = useRef<number | null>(null);

  const refresh = useCallback(async (id: string) => {
    try {
      const next = await getSeverityJob(id);
      setJob(next);
      setError("");
      return next;
    } catch (e) {
      setError(errorMessage(e, "Could not reach the severity analyser."));
      return null;
    }
  }, []);

  useEffect(() => {
    if (!jobId) return;
    const running = job?.status === "queued" || job?.status === "running" || !job;
    if (!running) return;

    timer.current = window.setInterval(() => void refresh(jobId), POLL_MS);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [jobId, job, refresh]);

  // only a finished analysis is worth attaching to the screening
  useEffect(() => {
    onReady(job?.status === "done" && jobId ? jobId : null);
  }, [job?.status, jobId, onReady]);

  // The page refuses to save while this is true, rather than saving a screening
  // that quietly lost the minute of work still in flight.
  useEffect(() => {
    onRunning?.(
      starting || job?.status === "queued" || job?.status === "running",
    );
  }, [starting, job?.status, onRunning]);

  useEffect(() => {
    if (job?.status === "done" && job.summary) onMeasured?.(job.summary.eyes);
  }, [job?.status, job?.summary, onMeasured]);

  async function run() {
    if (!selection) return;
    setStarting(true);
    setError("");
    setJob(null);
    try {
      const started = await startSeverityPreview(
        selection.eye,
        selection.images,
        meta,
      );
      setJobId(started.jobId);
      await refresh(started.jobId);
    } catch (e) {
      setError(errorMessage(e, "Could not start the severity analysis."));
    } finally {
      setStarting(false);
    }
  }

  const status = job?.status ?? (jobId ? "queued" : "none");

  /*
   * The line suggests; it does not decide.
   *
   * It used to disable the button, so an eye the model had flagged at 25% could
   * not be measured while the line sat at 40% — and nothing on screen said that
   * was why. Now the suggestion picks the eyes by default, and "measure both"
   * is always one press away.
   */
  const suggested = eyeResults
    .filter((result) => result.risk >= threshold)
    .map((result) => result.eye);
  const all = eyeResults.map((result) => result.eye);
  const selection = pickEyes(eye, images, suggested.length ? suggested : all);
  const belowTheLine = eyeResults.filter(
    (result) => result.flagged && result.risk < threshold,
  );

  return (
    <section>
      <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h2 className="font-heading text-display leading-none text-ink">
          Severity
        </h2>
        <p className="text-label text-ink-3">
          Phase 2 · zone and plus, measured from the vessels
        </p>
      </header>

      {belowTheLine.length > 0 && status === "none" && (
        <p className="mt-5 border-l-2 border-watch pl-4 text-label leading-relaxed text-watch">
          The {belowTheLine.map((r) => (r.eye ?? "").toLowerCase()).join(" and ")} eye
          {belowTheLine.length > 1 ? "s were" : " was"} flagged by the model but
          {belowTheLine.length > 1 ? " sit" : " sits"} below your measure line of{" "}
          {Math.round(threshold * 100)}%, so{" "}
          {belowTheLine.length > 1 ? "they are" : "it is"} not in the suggestion.
          Lower the line, or press the button to measure anyway.
        </p>
      )}

      {error && (
        <p className="mt-5 border-l-2 border-urgent pl-4 text-body text-urgent">
          {error}
        </p>
      )}

      {status === "none" && (
        <div className="mt-6 space-y-5">
          <ReferralThreshold
            threshold={threshold}
            onChange={onThreshold}
            eyeResults={eyeResults}
          />
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <button
              onClick={() => void run()}
              disabled={starting}
              className={primaryButtonClass}
            >
              {starting
                ? "Starting…"
                : suggested.length === 0
                  ? "Measure both eyes anyway"
                  : "Analyse severity"}
            </button>
            <span className="text-label text-ink-3">
              About a minute{selection?.eye === "Both" ? " for two eyes" : ""}. You
              can save the screening without it.
            </span>
          </div>
        </div>
      )}

      {(status === "queued" || status === "running") && (
        <div className="mt-6">
          <SeverityProgress
            step={job?.step ?? null}
            progress={job?.progress ?? null}
            seconds={job?.seconds ?? null}
          />
        </div>
      )}

      {status === "failed" && (
        <div className="mt-6 border-l-2 border-urgent pl-4">
          <p className="text-body text-urgent">The analysis did not finish</p>
          <div className="mt-1.5">
            <Note>{job?.error ?? "No reason was reported."}</Note>
          </div>
          <button
            onClick={() => void run()}
            disabled={starting}
            className={`${buttonClass} mt-4`}
          >
            Try again
          </button>
        </div>
      )}

      {status === "done" && job?.summary && (
        <div className="mt-8">
          <SeverityResults summary={job.summary} />
          <button
            onClick={() => void run()}
            disabled={starting}
            className={`${buttonClass} mt-10`}
          >
            Measure again
          </button>
        </div>
      )}
    </section>
  );
}

/**
 * Narrow the screening to the eyes the threshold asked for.
 *
 * Returns null when nothing is left to measure, which is a real outcome and not
 * an error — both eyes can sit below the line the doctor set.
 */
function pickEyes(
  eye: "Left" | "Right" | "Both",
  images: { left: File[]; right: File[] },
  wanted: string[],
): { eye: "Left" | "Right" | "Both"; images: { left: File[]; right: File[] } } | null {
  const left = eye !== "Right" && wanted.includes("Left");
  const right = eye !== "Left" && wanted.includes("Right");

  if (left && right) return { eye: "Both", images };
  if (left) return { eye: "Left", images: { left: images.left, right: [] } };
  if (right) return { eye: "Right", images: { left: [], right: images.right } };
  return null;
}
