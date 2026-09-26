import type { ComponentProps, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Three roles, and nothing else.
 *
 * `primary` is the one thing this screen is for. `secondary` is the way back
 * out of it. `quiet` is everything that is not really a decision. `danger` is
 * the same shape as secondary, because deleting should not look like the
 * obvious thing to press.
 *
 * The fill comes from tokens, so the same button is a dark slate button in the
 * app and a cyan glass button in the Workspace without a second component.
 */
type Variant = "primary" | "secondary" | "quiet" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
    primary:
        "border border-[var(--app-primary-line)] bg-[var(--app-primary-bg)] text-[var(--app-primary-ink)] hover:bg-[var(--app-primary-bg-hover)]",
    secondary: "border border-line bg-panel text-ink-2 hover:bg-inset hover:text-ink",
    quiet: "border border-transparent bg-transparent text-ink-2 hover:bg-inset hover:text-ink",
    danger: "border border-urgent-line bg-transparent text-urgent hover:bg-urgent-wash",
};

const SIZE: Record<Size, string> = {
    sm: "h-8 gap-1.5 px-2.5 text-label",
    md: "h-9 gap-2 px-3.5 text-body",
    lg: "h-11 gap-2 px-5 text-body",
};

export function Button({
    variant = "secondary",
    size = "md",
    icon: Icon,
    busy = false,
    children,
    className,
    disabled,
    ...rest
}: {
    variant?: Variant;
    size?: Size;
    icon?: LucideIcon;
    /** Shows a spinner in place of the icon and blocks a second press. */
    busy?: boolean;
    children: ReactNode;
} & Omit<ComponentProps<"button">, "children">) {
    const Leading = busy ? Loader2 : Icon;

    return (
        <button
            type="button"
            disabled={disabled || busy}
            className={cn(
                "inline-flex cursor-pointer items-center justify-center rounded-lg font-medium transition-colors",
                "disabled:cursor-not-allowed disabled:opacity-45",
                VARIANT[variant],
                SIZE[size],
                className,
            )}
            {...rest}
        >
            {Leading && (
                <Leading
                    className={cn("size-4 shrink-0", busy && "animate-spin")}
                    strokeWidth={1.8}
                    aria-hidden
                />
            )}
            {children}
        </button>
    );
}

/**
 * An icon on its own. The label is required, not optional: an icon with no
 * name is a button nobody can describe, on the phone, to a colleague.
 */
export function IconButton({
    icon: Icon,
    label,
    tone = "quiet",
    className,
    ...rest
}: {
    icon: LucideIcon;
    label: string;
    tone?: "quiet" | "danger";
} & Omit<ComponentProps<"button">, "children">) {
    return (
        <button
            type="button"
            aria-label={label}
            title={label}
            className={cn(
                "flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-colors",
                "disabled:cursor-not-allowed disabled:opacity-40",
                tone === "danger"
                    ? "text-ink-3 hover:bg-urgent-wash hover:text-urgent"
                    : "text-ink-3 hover:bg-inset hover:text-ink",
                className,
            )}
            {...rest}
        >
            <Icon className="size-4" strokeWidth={1.8} aria-hidden />
        </button>
    );
}
