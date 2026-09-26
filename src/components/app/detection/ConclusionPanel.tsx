import { Check, Edit3 } from "lucide-react";
import { Eyebrow, IconButton } from "@/components/ui";
import { DOCTOR_DECISIONS, type DoctorDecision } from "@/lib/detections";
import { cn } from "@/lib/utils";

/**
 * What the doctor concluded, beside what the model estimated.
 *
 * It used to sit in a band of its own below the eye results, so the estimate
 * and the decision it informs were never on screen together. Here the two read
 * side by side, which is the comparison the page exists to make.
 *
 * The pen opens the page's one editing mode; the bar at the foot of the page
 * saves it. This panel had its own Save and Cancel, which did exactly what the
 * bar does — and a record written two ways is how nobody could tell what was
 * already down.
 */

const TONE: Record<string, string> = {
  "Confirms ROP": "border-urgent-line bg-urgent-wash text-urgent",
  "No ROP": "border-steady-line bg-steady-wash text-steady",
  Uncertain: "border-watch-line bg-watch-wash text-watch",
  Pending: "border-line bg-inset text-ink-2",
};

export default function ConclusionPanel({
  decision,
  onDecision,
  editing,
  recordedAt,
  onEdit,
}: {
  decision: DoctorDecision;
  onDecision: (decision: DoctorDecision) => void;
  editing: boolean;
  /** When this conclusion was recorded, if it has been. */
  recordedAt?: string;
  /** Opens the page's editing mode. The page's own bar does the saving. */
  onEdit: () => void;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-panel">
      <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <Eyebrow>Your conclusion</Eyebrow>
          {recordedAt && (
            <p className="mt-1.5 text-label text-ink-3">Recorded {recordedAt}</p>
          )}
        </div>
        {!editing && (
          <IconButton
            icon={Edit3}
            label="Change your conclusion"
            onClick={onEdit}
            className="-mr-2 -mt-1.5"
          />
        )}
      </header>

      <div className="p-5">
        <div className="grid gap-2">
          {DOCTOR_DECISIONS.map((choice) => {
            const active = decision === choice;
            return (
              <button
                key={choice}
                type="button"
                disabled={!editing}
                aria-pressed={active}
                onClick={() => onDecision(choice)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg border px-3.5 py-2.5 text-body font-medium transition-colors",
                  editing ? "cursor-pointer" : "cursor-default",
                  active
                    ? TONE[choice]
                    : "border-line bg-panel text-ink-3 hover:text-ink disabled:hover:text-ink-3",
                  !editing && !active && "opacity-45",
                )}
              >
                <Check
                  className={cn("size-4 shrink-0", !active && "invisible")}
                  aria-hidden
                />
                {choice === "Pending" ? "Not decided" : choice}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
