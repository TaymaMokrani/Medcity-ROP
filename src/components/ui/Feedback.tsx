import type { ReactNode } from "react";
import { AlertTriangle, Loader2, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./Button";

/**
 * What a screen shows when it has nothing to show.
 *
 * A failed load must never look like a quiet result. A dashboard that prints
 * "0 flagged" because the network dropped is worse than one that prints
 * nothing, so an error replaces the numbers rather than sitting above them.
 */

export function ErrorBand({
    message,
    onRetry,
    className,
}: {
    message: string;
    onRetry?: () => void;
    className?: string;
}) {
    return (
        <div
            role="alert"
            className={cn(
                "flex flex-wrap items-center gap-3 rounded-xl border border-urgent-line bg-urgent-wash px-4 py-3",
                className,
            )}
        >
            <AlertTriangle className="size-4 shrink-0 text-urgent" aria-hidden />
            <p className="min-w-0 flex-1 text-body text-urgent">{message}</p>
            {onRetry && (
                <Button size="sm" icon={RotateCcw} onClick={onRetry}>
                    Try again
                </Button>
            )}
        </div>
    );
}

/** A field-level or inline complaint. Quieter than a band, same colour. */
export function InlineError({ children }: { children: ReactNode }) {
    return (
        <p role="alert" className="mt-1 text-label text-urgent">
            {children}
        </p>
    );
}

export function Loading({
    label = "Loading…",
    className,
}: {
    label?: string;
    className?: string;
}) {
    return (
        <p
            className={cn(
                "flex items-center justify-center gap-2 py-10 text-body text-ink-3",
                className,
            )}
        >
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {label}
        </p>
    );
}

export function EmptyState({
    title,
    hint,
    action,
    className,
}: {
    title: string;
    hint?: string;
    action?: ReactNode;
    className?: string;
}) {
    return (
        <div className={cn("px-6 py-14 text-center", className)}>
            <p className="text-body font-medium text-ink-2">{title}</p>
            {hint && <p className="mt-1 text-label text-ink-3">{hint}</p>}
            {action && <div className="mt-5 flex justify-center">{action}</div>}
        </div>
    );
}
