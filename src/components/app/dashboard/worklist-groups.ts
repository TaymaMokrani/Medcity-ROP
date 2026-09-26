import type { Detection } from "@/lib/detections";
import { verdictFor } from "@/lib/screening";

/**
 * How the worklist is grouped.
 *
 * Lives beside the component rather than inside it so the grouping can be read
 * — and later tested — without rendering anything.
 */

export interface Group {
    key: string;
    title: string;
    hint: string;
    /** The filtered screening list this group is the top of. */
    to: string;
    items: Detection[];
}

export function buildWorklist(detections: Detection[]): Group[] {
    const undecided = detections.filter(
        (d) => (d.doctorDecision ?? "Pending") === "Pending",
    );

    return [
        {
            key: "flagged",
            title: "Flagged, waiting for your conclusion",
            hint: "",
            to: "/app/detection?decision=Pending",
            items: undecided.filter((d) => verdictFor(d).state === "Flagged"),
        },
        {
            // Flagged, and nobody has looked at the vessels. Phase 2 is where
            // zone and plus come from, so this is the gap between "something is
            // wrong" and "here is how wrong".
            key: "unmeasured",
            title: "Flagged, never measured for severity",
            hint: "",
            to: "/app/detection?decision=Flagged",
            items: detections.filter(
                (d) =>
                    d.flagged &&
                    (d.phase2Status ?? "none") !== "done" &&
                    (d.phase2Status ?? "none") !== "running" &&
                    (d.phase2Status ?? "none") !== "queued",
            ),
        },
    ].filter((group) => group.items.length > 0);
}
