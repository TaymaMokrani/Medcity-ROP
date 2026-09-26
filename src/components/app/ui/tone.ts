/**
 * The severity screen's house style, now the app's.
 *
 * Colour for the four clinical states is decided once, in `components/ui/tone`,
 * and this file only keeps the names the severity components already use. The
 * two button classes are here for the same reason — they are the `Button`
 * component's primary and secondary, written out for the handful of places that
 * still apply a class rather than render one.
 */
export { SEVERITY_LABEL, TONE, severityTone, type Tone } from "@/components/ui/tone";

export const buttonClass =
    "inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-lg border border-line bg-panel px-3.5 text-body font-medium text-ink-2 transition-colors hover:bg-inset hover:text-ink disabled:cursor-not-allowed disabled:opacity-45";

export const primaryButtonClass =
    "inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-lg border border-[var(--app-primary-line)] bg-[var(--app-primary-bg)] px-4 text-body font-medium text-[var(--app-primary-ink)] transition-colors hover:bg-[var(--app-primary-bg-hover)] disabled:cursor-not-allowed disabled:opacity-45";
