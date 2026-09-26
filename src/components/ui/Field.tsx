import { useId, type ComponentProps, type ReactNode } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { InlineError } from "./Feedback";
import { fieldClass } from "./styles";

/**
 * One field, one label, one error.
 *
 * The label is a real `<label>` tied to the control, so it can be clicked, read
 * aloud, and filled in by a password manager. Errors sit under the field they
 * belong to and are announced, rather than collected at the top of the form
 * where the eye has already moved on.
 */

export function Field({
    label,
    hint,
    error,
    required,
    children,
    className,
}: {
    label: string;
    hint?: ReactNode;
    error?: string;
    required?: boolean;
    /** Takes the id, so the label points at the real control. */
    children: (props: { id: string; "aria-describedby"?: string }) => ReactNode;
    className?: string;
}) {
    const id = useId();
    const hintId = hint ? `${id}-hint` : undefined;
    const errorId = error ? `${id}-error` : undefined;
    const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

    return (
        <div className={className}>
            <label
                htmlFor={id}
                className="mb-1.5 block text-label font-medium text-ink-2"
            >
                {label}
                {required && (
                    <span className="ml-1 text-urgent" aria-hidden>
                        *
                    </span>
                )}
            </label>
            {children({ id, "aria-describedby": describedBy })}
            {hint && (
                <p id={hintId} className="mt-1 text-micro text-ink-3">
                    {hint}
                </p>
            )}
            {error && <InlineError>{error}</InlineError>}
        </div>
    );
}

export function TextInput({
    error,
    className,
    ...rest
}: { error?: string } & ComponentProps<"input">) {
    return (
        <input
            aria-invalid={error ? true : undefined}
            className={cn(fieldClass(error), className)}
            {...rest}
        />
    );
}

export function Select({
    error,
    className,
    children,
    ...rest
}: { error?: string } & ComponentProps<"select">) {
    return (
        <select
            aria-invalid={error ? true : undefined}
            className={cn(fieldClass(error), "cursor-pointer pr-8", className)}
            {...rest}
        >
            {children}
        </select>
    );
}

export function Textarea({
    error,
    className,
    ...rest
}: { error?: string } & ComponentProps<"textarea">) {
    return (
        <textarea
            aria-invalid={error ? true : undefined}
            className={cn(
                fieldClass(error),
                "h-auto resize-none py-2 leading-relaxed",
                className,
            )}
            {...rest}
        />
    );
}

/** A search box. Its own component because every list needs the same one. */
export function SearchInput({
    label = "Search",
    className,
    ...rest
}: { label?: string } & ComponentProps<"input">) {
    return (
        <div className={cn("relative", className)}>
            <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3"
                aria-hidden
            />
            <input
                type="search"
                aria-label={label}
                className={cn(fieldClass(), "pl-9")}
                {...rest}
            />
        </div>
    );
}
