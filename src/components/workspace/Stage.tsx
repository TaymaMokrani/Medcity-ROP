import type { ReactNode } from "react";
import { ImagePlus, Loader2, Users2 } from "lucide-react";

/** The pill the sidebar's "Add Detection" uses, so the Workspace speaks the same language. */
export const pillClass =
  "inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-full border border-white/15 bg-white/[0.08] px-6 text-body font-medium text-ink backdrop-blur-md transition-all duration-300 hover:border-accent/50 hover:bg-white/[0.14] disabled:cursor-not-allowed disabled:opacity-40";

/**
 * What the canvas shows before a picture is open: a faint outline where the
 * retina will sit, and whatever this moment needs, centred inside it.
 */
export function Stage({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex size-full items-center justify-center overflow-hidden bg-[#020305]">
      <div className="pointer-events-none absolute aspect-square h-[78%] max-w-[80%] rounded-full border border-dashed border-white/[0.08]" />
      <div className="pointer-events-none absolute aspect-square h-[78%] max-w-[80%] rounded-full bg-[radial-gradient(closest-side,rgba(56,189,248,0.06),transparent)]" />
      <div className="relative flex max-w-md flex-col items-center px-6 text-center">{children}</div>
    </div>
  );
}

/** Nothing open yet: the two ways in. */
export function EmptyStage({
  onOpenPatient,
  onImportImages,
}: {
  onOpenPatient: () => void;
  onImportImages: () => void;
}) {
  return (
    <Stage>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button onClick={onOpenPatient} className={pillClass}>
          <Users2 className="size-4 text-accent" /> Open existing patient
        </button>
        <button onClick={onImportImages} className={pillClass}>
          <ImagePlus className="size-4 text-accent" /> Import images
        </button>
      </div>
    </Stage>
  );
}

/** Measuring in progress: which step it is on, and how far along. */
export function ProgressStage({
  step,
  progress,
  seconds,
}: {
  step: string | null;
  progress: { done: number; total: number } | null;
  seconds: number | null;
}) {
  const fraction =
    progress && progress.total > 0 ? Math.min(1, progress.done / progress.total) : null;

  return (
    <Stage>
      <h2 className="font-heading text-xl text-ink">Measuring the vessels</h2>
      <div className="mt-5 h-1 w-72 overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className={`h-full rounded-full bg-accent transition-[width] duration-700 ${
            fraction === null ? "w-1/4 animate-pulse" : ""
          }`}
          style={fraction === null ? undefined : { width: `${Math.max(4, fraction * 100)}%` }}
        />
      </div>
      <p className="mt-3 flex items-center gap-2 text-label text-ink-3">
        <Loader2 className="size-3.5 animate-spin text-accent" />
        {step ? step.charAt(0).toUpperCase() + step.slice(1) : "Waiting for the analyser"}
        {seconds != null && seconds > 0 && (
          <span className="tabular-nums text-white/35">· {Math.round(seconds)} s</span>
        )}
      </p>
    </Stage>
  );
}

/** A plain message in the canvas, with what can be done about it. */
export function MessageStage({
  title,
  children,
  actions,
  busy,
}: {
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  busy?: boolean;
}) {
  return (
    <Stage>
      {busy && <Loader2 className="mb-3 size-5 animate-spin text-ink-3" />}
      <h2 className="font-heading text-xl text-ink">{title}</h2>
      {children && (
        <div className="mt-2 text-body leading-relaxed text-ink-3">{children}</div>
      )}
      {actions && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">{actions}</div>
      )}
    </Stage>
  );
}
