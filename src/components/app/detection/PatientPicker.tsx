import { useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, UserPlus } from "lucide-react";
import type { Patient } from "@/lib/patients";
import { daysOfLife, formatDate, formatPma } from "@/lib/format";
import { formatWeeks } from "@/lib/validation";
import { Button, InlineError } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * Choosing whose eyes these are.
 *
 * Nothing is chosen to begin with. The old dropdown opened on whichever patient
 * happened to be first in the list, so a screening saved without touching it
 * went onto that baby's chart — right photographs, wrong record, and no step in
 * between where anyone was asked.
 *
 * So: no default, a box that filters as you type, and the four facts that
 * identify a newborn on every row. The name alone is not enough when a unit has
 * two babies from the same family in the same week.
 */
export default function PatientPicker({
    patients,
    value,
    onChange,
    onAddPatient,
    error,
}: {
    patients: Patient[];
    value: string;
    onChange: (patientId: string) => void;
    onAddPatient: () => void;
    error?: string;
}) {
    const [query, setQuery] = useState("");
    const [open, setOpen] = useState(false);
    const box = useRef<HTMLDivElement | null>(null);

    const selected = patients.find((p) => p.id === value) ?? null;

    const matches = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return patients.slice(0, 50);
        return patients
            .filter((p) =>
                [p.firstName, p.lastName, p.id, p.motherName]
                    .filter(Boolean)
                    .some((field) => field.toLowerCase().includes(q)),
            )
            .slice(0, 50);
    }, [patients, query]);

    return (
        <div
            ref={box}
            className="relative"
            onBlur={(event) => {
                if (!box.current?.contains(event.relatedTarget as Node)) setOpen(false);
            }}
        >
            <label
                htmlFor="patient-search"
                className="mb-1.5 block text-label font-medium text-ink-2"
            >
                Patient
                <span className="ml-1 text-urgent" aria-hidden>
                    *
                </span>
            </label>

            {selected ? (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-line bg-inset px-3 py-2.5">
                    <span className="text-body font-medium text-ink">
                        {selected.firstName} {selected.lastName}
                    </span>
                    <span className="text-label text-ink-3 tabular-nums">
                        {selected.id} · born {formatDate(selected.dateOfBirth)} ·{" "}
                        {formatWeeks(selected.gestationalAge)} at birth · PMA{" "}
                        {formatPma(selected.dateOfBirth, selected.gestationalAge)} ·{" "}
                        {daysOfLife(selected.dateOfBirth)} days old
                    </span>
                    <button
                        type="button"
                        onClick={() => {
                            onChange("");
                            setQuery("");
                            setOpen(true);
                        }}
                        className="ml-auto cursor-pointer text-label text-ink-3 underline-offset-4 hover:text-ink hover:underline"
                    >
                        Change
                    </button>
                </div>
            ) : (
                <>
                    <div className="relative">
                        <Search
                            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3"
                            aria-hidden
                        />
                        <input
                            id="patient-search"
                            role="combobox"
                            aria-expanded={open}
                            aria-controls="patient-options"
                            autoComplete="off"
                            placeholder="Search by name, record number or mother"
                            value={query}
                            onChange={(event) => {
                                setQuery(event.target.value);
                                setOpen(true);
                            }}
                            onFocus={() => setOpen(true)}
                            className={cn(
                                "h-9 w-full rounded-lg border bg-[var(--app-field-bg)] pl-9 pr-9 text-body text-ink placeholder:text-ink-3",
                                error ? "border-urgent-line" : "border-line",
                            )}
                        />
                        <ChevronDown
                            className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-3"
                            aria-hidden
                        />
                    </div>

                    {open && (
                        <ul
                            id="patient-options"
                            role="listbox"
                            className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-line bg-panel py-1 shadow-lg"
                        >
                            {matches.length === 0 ? (
                                <li className="flex flex-wrap items-center gap-3 px-3 py-3">
                                    <span className="text-body text-ink-3">
                                        No patient matches “{query}”.
                                    </span>
                                    <Button size="sm" icon={UserPlus} onClick={onAddPatient}>
                                        Add this baby
                                    </Button>
                                </li>
                            ) : (
                                matches.map((patient) => (
                                    <li key={patient.id}>
                                        <button
                                            type="button"
                                            role="option"
                                            aria-selected={patient.id === value}
                                            onClick={() => {
                                                onChange(patient.id);
                                                setOpen(false);
                                            }}
                                            className="flex w-full cursor-pointer items-baseline gap-3 px-3 py-2 text-left transition-colors hover:bg-inset"
                                        >
                                            <span className="min-w-0 flex-1 truncate text-body text-ink">
                                                {patient.firstName} {patient.lastName}
                                            </span>
                                            <span className="shrink-0 text-micro text-ink-3 tabular-nums">
                                                {patient.id} · {formatWeeks(patient.gestationalAge)} ·{" "}
                                                {formatDate(patient.dateOfBirth)}
                                            </span>
                                            {patient.id === value && (
                                                <Check className="size-4 shrink-0 text-accent" aria-hidden />
                                            )}
                                        </button>
                                    </li>
                                ))
                            )}
                        </ul>
                    )}
                </>
            )}

            {error && <InlineError>{error}</InlineError>}
        </div>
    );
}
