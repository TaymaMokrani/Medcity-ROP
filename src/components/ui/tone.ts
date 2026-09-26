import type { Severity } from "@/lib/severity";

/**
 * The four clinical states, in the app's own colours.
 *
 * Every screen reads a state from here, so a severity is the same colour on
 * the dashboard, on the screening, in the Workspace and on paper. The classes
 * point at tokens rather than at a palette, which is what lets the same
 * component sit on the light app and on the dark Workspace.
 *
 * `unresolved` is deliberately off the traffic light. An eye that could not be
 * measured is not a mild eye, and colouring it green or grey says it is.
 */
export type Tone = "urgent" | "watch" | "steady" | "unresolved" | "neutral";

export const TONE: Record<
    Tone,
    { text: string; border: string; wash: string; dot: string }
> = {
    urgent: {
        text: "text-urgent",
        border: "border-urgent-line",
        wash: "bg-urgent-wash",
        dot: "bg-urgent",
    },
    watch: {
        text: "text-watch",
        border: "border-watch-line",
        wash: "bg-watch-wash",
        dot: "bg-watch",
    },
    steady: {
        text: "text-steady",
        border: "border-steady-line",
        wash: "bg-steady-wash",
        dot: "bg-steady",
    },
    unresolved: {
        text: "text-unresolved",
        border: "border-unresolved-line",
        wash: "bg-unresolved-wash",
        dot: "bg-unresolved",
    },
    neutral: {
        text: "text-ink-2",
        border: "border-line",
        wash: "bg-inset",
        dot: "bg-ink-3",
    },
};

/** How each severity reads, and the one word it is called. */
export const SEVERITY_LABEL: Record<Severity, string> = {
    severe: "Severe",
    intermediate: "Intermediate",
    lower: "Lower",
    unknown: "Could not assess",
};

export function severityTone(severity: Severity) {
    const tone: Tone =
        severity === "severe"
            ? "urgent"
            : severity === "intermediate"
              ? "watch"
              : severity === "lower"
                ? "steady"
                : "unresolved";
    return { tone, label: SEVERITY_LABEL[severity], ...TONE[tone] };
}
