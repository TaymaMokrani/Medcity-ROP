import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A sortable column heading.
 *
 * It is a button inside the cell rather than a click handler on the cell, so it
 * can be reached with the keyboard, and the table tells assistive software
 * which column is sorted and which way. The arrow shows the direction it is
 * sorted in now, not the one clicking would produce.
 */
export default function SortHeader<T extends string>({
    label,
    field,
    sortField,
    sortDir,
    onSort,
    align = "left",
    className,
}: {
    label: string;
    field: T;
    sortField: T;
    sortDir: "asc" | "desc";
    onSort: (field: T) => void;
    align?: "left" | "right";
    className?: string;
}) {
    const active = sortField === field;
    const Icon = !active ? ChevronsUpDown : sortDir === "asc" ? ArrowUp : ArrowDown;

    return (
        <th
            scope="col"
            aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
            className={cn(
                "px-3 py-2.5 text-micro font-medium uppercase tracking-[0.14em] text-ink-3",
                align === "right" ? "text-right" : "text-left",
                className,
            )}
        >
            <button
                type="button"
                onClick={() => onSort(field)}
                className={cn(
                    "inline-flex cursor-pointer items-center gap-1.5 transition-colors hover:text-ink",
                    active && "text-ink",
                )}
            >
                {label}
                <Icon className="size-3" aria-hidden />
            </button>
        </th>
    );
}

/** A heading with nothing to sort by. Same shape, no button. */
export function PlainHeader({
    children,
    align = "left",
    className,
}: {
    children: React.ReactNode;
    align?: "left" | "right";
    className?: string;
}) {
    return (
        <th
            scope="col"
            className={cn(
                "px-3 py-2.5 text-micro font-medium uppercase tracking-[0.14em] text-ink-3",
                align === "right" ? "text-right" : "text-left",
                className,
            )}
        >
            {children}
        </th>
    );
}
