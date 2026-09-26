import { cn } from "@/lib/utils";

/** The one control shape: a field is this tall, this round, this bordered. */
const CONTROL =
    "h-9 w-full rounded-lg border bg-[var(--app-field-bg)] px-3 text-body text-ink transition-colors placeholder:text-ink-3 disabled:cursor-not-allowed disabled:opacity-60";

export function fieldClass(error?: unknown) {
    return cn(CONTROL, error ? "border-urgent-line" : "border-line hover:border-ink-3/50");
}
