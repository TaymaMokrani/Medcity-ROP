import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { TONE, type Tone } from "./tone";

/**
 * The pieces a screen is built from: a band, a label, a number, a chip, a fold.
 *
 * Hairlines and space do the work cards used to do, which is what lets the
 * retina photograph and the headline be the only two things on a screen with
 * any weight. Everything here works in both themes, because it only ever
 * names tokens.
 */

/** A band of the page: a rule, a quiet label, and the content under it. */
export function Band({
    title,
    meta,
    action,
    children,
    className = "",
    /**
     * Drops the rule and the space above it, for bands that sit side by side
     * inside a row that already drew one across the whole width. Two bands each
     * drawing their own rule leaves a gap in the middle of the line.
     */
    flush = false,
}: {
    title?: string;
    meta?: ReactNode;
    action?: ReactNode;
    children: ReactNode;
    className?: string;
    flush?: boolean;
}) {
    return (
        <section
            className={cn(
                flush ? "" : "mt-10 border-t border-line pt-7 first:mt-0",
                className,
            )}
        >
            {(title || meta || action) && (
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                    {title && <Eyebrow>{title}</Eyebrow>}
                    {meta && <p className="text-label text-ink-3">{meta}</p>}
                    {action}
                </div>
            )}
            <div className={cn(title || meta || action ? "mt-5" : "")}>{children}</div>
        </section>
    );
}

/** A boxed group, for forms and side columns where a band would drift apart. */
export function Panel({
    title,
    icon,
    action,
    children,
    className = "",
}: {
    title?: string;
    icon?: ReactNode;
    action?: ReactNode;
    children: ReactNode;
    className?: string;
}) {
    return (
        <section className={cn("rounded-xl border border-line bg-panel p-5", className)}>
            {(title || action) && (
                <header className="mb-4 flex items-center justify-between gap-3">
                    <h3 className="flex items-center gap-2 text-body font-semibold text-ink">
                        {icon && <span className="text-ink-3">{icon}</span>}
                        {title}
                    </h3>
                    {action}
                </header>
            )}
            {children}
        </section>
    );
}

export function Eyebrow({
    children,
    className,
}: {
    children: ReactNode;
    className?: string;
}) {
    return (
        <p
            className={cn(
                "text-micro font-medium uppercase tracking-[0.16em] text-ink-3",
                className,
            )}
        >
            {children}
        </p>
    );
}

/** A single number, stated plainly, with nothing drawn around it. */
export function Stat({
    label,
    value,
    detail,
}: {
    label: string;
    value: ReactNode;
    detail?: ReactNode;
}) {
    return (
        <div>
            <Eyebrow>{label}</Eyebrow>
            <p className="mt-2 font-heading text-display leading-none text-ink tabular-nums">
                {value}
            </p>
            {detail && <p className="mt-2 text-label text-ink-3">{detail}</p>}
        </div>
    );
}

/** Label left, number right, a hairline between. No metric cards. */
export function Measurements({
    rows,
}: {
    rows: [label: string, value: ReactNode][];
}) {
    return (
        <dl className="divide-y divide-line-soft border-y border-line-soft">
            {rows.map(([label, value]) => (
                <div
                    key={label}
                    className="flex items-baseline justify-between gap-6 py-2.5"
                >
                    <dt className="text-body text-ink-2">{label}</dt>
                    <dd className="text-right text-body text-ink tabular-nums">{value}</dd>
                </div>
            ))}
        </dl>
    );
}

/** A state, said in one word. The dot carries the colour, not the whole pill. */
export function Chip({
    tone = "neutral",
    dot = true,
    children,
    className,
}: {
    tone?: Tone;
    dot?: boolean;
    children: ReactNode;
    className?: string;
}) {
    const t = TONE[tone];
    return (
        <span
            className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-label font-medium",
                t.border,
                t.wash,
                t.text,
                className,
            )}
        >
            {dot && <span className={cn("size-1.5 shrink-0 rounded-full", t.dot)} />}
            {children}
        </span>
    );
}

/** Body copy for anything explanatory. Narrow, quiet, never bold. */
export function Note({ children }: { children: ReactNode }) {
    return (
        <p className="max-w-prose text-label leading-relaxed text-ink-3">{children}</p>
    );
}

/** Methodology, folded away until someone asks for it. */
export function Disclosure({
    summary,
    meta,
    children,
}: {
    summary: string;
    meta?: ReactNode;
    children: ReactNode;
}) {
    return (
        <details className="group border-b border-line-soft first:border-t">
            <summary className="flex cursor-pointer list-none items-center gap-2 py-3 text-body text-ink-2 transition-colors hover:text-ink">
                <ChevronRight
                    size={14}
                    className="shrink-0 text-ink-3 transition-transform group-open:rotate-90"
                />
                <span>{summary}</span>
                {meta && <span className="ml-auto text-label text-ink-3">{meta}</span>}
            </summary>
            <div className="pb-6 pl-6 pr-1">{children}</div>
        </details>
    );
}
