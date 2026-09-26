import type { ReactNode } from "react";
import { Edit3 } from "lucide-react";
import type { Eye } from "@/lib/detections";
import {
    ICROP_STAGES,
    PLUS_GRADES,
    ZONES,
    type IcropStage,
    type PlusGrade,
    type SeverityEye,
    type Zone,
} from "@/lib/severity";
import { Eyebrow, IconButton, Select, Textarea } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * What the examiner found, beside what the analyser measured.
 *
 * Two things were wrong before. The stage box lived inside the severity
 * results, so a screening with no analysis — or a failed one — had nowhere to
 * record a stage at all, and the doctor's own finding depended on the machine
 * having run first. And zone and plus were the analyser's alone: a doctor who
 * disagreed with a measured zone had no way to say so.
 *
 * So all three axes are here, always, whether or not anything has been
 * measured. The analyser's value and the examiner's sit together and are never
 * merged. Today the analyser's stage is always empty, because nothing in the
 * pipeline detects the demarcation line or the ridge. When a stage model
 * exists it fills that value, and this screen does not have to change.
 *
 * Three panels — the two eyes and the notes — under one pen. There is one
 * editing mode and one save, so three pens were three doors into the same
 * room: whichever you pressed, all of it opened.
 *
 * Where the analyser could not measure an axis it prints a dash and nothing
 * else. Its reason for failing is a sentence about the photographs, not a
 * finding about the baby, and it ran longer than the row it sat in.
 */

export interface ExaminerEntry {
    stage?: IcropStage | null;
    zone?: Zone | null;
    plus?: PlusGrade | null;
}

export default function ExaminerRecord({
    eyes,
    measured,
    entries,
    editing,
    onChange,
    notes,
    onNotes,
    onEdit,
}: {
    /** The eyes this screening covers, whether or not they were measured. */
    eyes: Eye[];
    /** The analyser's assessment per eye, when there is one. */
    measured: SeverityEye[];
    entries: Partial<Record<Eye, ExaminerEntry>>;
    editing: boolean;
    onChange: (eye: Eye, entry: ExaminerEntry) => void;
    /**
     * The screening's notes, as the third panel. Left out where the page keeps
     * its own notes field — the new-screening form does, and two boxes writing
     * to one field is worse than either.
     */
    notes?: string;
    onNotes?: (notes: string) => void;
    /** Opens the page's editing mode. Absent where the page is always editing. */
    onEdit?: () => void;
}) {
    return (
        <section className="mt-10 border-t border-line pt-7">
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
                <h2 className="font-heading text-display leading-none text-ink">
                    Examiner decision
                </h2>
                {!editing && onEdit && (
                    <IconButton
                        icon={Edit3}
                        label="Edit the examiner decision"
                        onClick={onEdit}
                    />
                )}
            </div>
            <p className="mt-2 text-label text-ink-3">
                Your findings, kept apart from the analyser's
            </p>

            <div
                className={cn(
                    "mt-6 grid items-start gap-6",
                    onNotes ? "lg:grid-cols-3" : "lg:grid-cols-2",
                )}
            >
                {eyes.map((eye) => {
                    const side = eye === "Left" ? "L" : "R";
                    const analysis = measured.find((m) => m.eye === side);
                    const entry = entries[eye] ?? {};

                    return (
                        <Panel
                            key={eye}
                            title={`${eye} eye`}
                        >
                            <dl className="divide-y divide-line-soft">
                                <Row
                                    label="Zone"
                                    machine={icropValue(analysis?.icrop.zone.value, "Zone ")}
                                    editing={editing}
                                    value={entry.zone ?? ""}
                                    options={ZONES.map((z) => ({
                                        value: z,
                                        label: `Zone ${z}`,
                                    }))}
                                    onChange={(value) =>
                                        onChange(eye, {
                                            ...entry,
                                            zone: value ? (value as Zone) : null,
                                        })
                                    }
                                />
                                <Row
                                    label="Plus disease"
                                    machine={icropValue(analysis?.icrop.plus.value)}
                                    editing={editing}
                                    value={entry.plus ?? ""}
                                    options={PLUS_GRADES.map((p) => ({
                                        value: p,
                                        label: p,
                                    }))}
                                    onChange={(value) =>
                                        onChange(eye, {
                                            ...entry,
                                            plus: value ? (value as PlusGrade) : null,
                                        })
                                    }
                                />
                                <Row
                                    label="Stage"
                                    machine={null}
                                    editing={editing}
                                    value={
                                        entry.stage === null || entry.stage === undefined
                                            ? ""
                                            : String(entry.stage)
                                    }
                                    options={ICROP_STAGES.map((s) => ({
                                        value: String(s),
                                        label: s === 0 ? "0 — no ROP staging" : `Stage ${s}`,
                                    }))}
                                    onChange={(value) =>
                                        onChange(eye, {
                                            ...entry,
                                            stage: value === "" ? null : (Number(value) as IcropStage),
                                        })
                                    }
                                />
                            </dl>
                        </Panel>
                    );
                })}

                {onNotes && (
                    <Panel title="Notes">
                        {editing ? (
                            <Textarea
                                rows={7}
                                value={notes ?? ""}
                                aria-label="Notes"
                                placeholder="Anything worth recording about this screening."
                                onChange={(event) => onNotes(event.target.value)}
                            />
                        ) : (
                            <p className="whitespace-pre-line break-words py-1 text-body leading-relaxed text-ink-2">
                                {notes || <span className="text-ink-3">No notes</span>}
                            </p>
                        )}
                    </Panel>
                )}
            </div>
        </section>
    );
}

/** One of the three. The pen that opens all of them is on the section. */
function Panel({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="overflow-hidden rounded-xl border border-line bg-panel">
            <header className="border-b border-line px-5 py-3.5">
                <Eyebrow>{title}</Eyebrow>
            </header>
            <div className="px-5 py-3">{children}</div>
        </section>
    );
}

/** The analyser's value for one axis, or nothing if it could not assess it. */
function icropValue(
    value: string | number | null | undefined,
    prefix = "",
): string | null {
    if (value === null || value === undefined || value === "") return null;
    return `${prefix}${value}`;
}

function Row({
    label,
    machine,
    editing,
    value,
    options,
    onChange,
}: {
    label: string;
    machine: string | null;
    editing: boolean;
    value: string;
    options: { value: string; label: string }[];
    onChange: (value: string) => void;
}) {
    return (
        <div className="py-3">
            <div className="flex items-baseline justify-between gap-3">
                <dt className="text-label text-ink-3">{label}</dt>
                <dd
                    className={cn(
                        "text-body capitalize tabular-nums",
                        machine ? "text-ink" : "text-ink-3",
                    )}
                >
                    {machine ?? "—"}
                </dd>
            </div>

            <dd className="mt-1.5">
                {editing ? (
                    <Select
                        value={value}
                        aria-label={`${label}, as recorded by the examiner`}
                        onChange={(event) => onChange(event.target.value)}
                    >
                        <option value="">Not recorded</option>
                        {options.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </Select>
                ) : (
                    <p
                        className={cn(
                            "rounded-lg bg-inset px-2.5 py-1.5 text-label capitalize",
                            value ? "text-ink" : "text-ink-3",
                        )}
                    >
                        {options.find((o) => o.value === value)?.label ?? "Not recorded"}
                        <span className="ml-2 normal-case text-ink-3">yours</span>
                    </p>
                )}
            </dd>
        </div>
    );
}
