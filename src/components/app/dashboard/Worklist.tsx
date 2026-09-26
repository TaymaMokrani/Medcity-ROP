import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { formatRisk } from "@/lib/detections";
import { formatDate } from "@/lib/format";
import type { Group } from "./worklist-groups";
import { Chip } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * Who needs the doctor today.
 *
 * The dashboard used to open with how the unit is doing and put the babies at
 * the bottom, under three charts. A screening list is not a quarterly report:
 * the first thing on the screen should be the work, and the work is the
 * screenings that are waiting on a person.
 *
 * The groups sit side by side, three rows each, with the rest a click away — a
 * doctor should see every kind of work that is waiting without scrolling past
 * one long column of it. Each row is a link, so it opens with the keyboard and
 * into a new tab.
 */

const SHOWN = 3;

export function Worklist({ groups }: { groups: Group[] }) {
    if (groups.length === 0) {
        return (
            <p className="py-6 text-body text-ink-3">
                Nothing is waiting on you. Every screening on record has a conclusion.
            </p>
        );
    }

    return (
        <div className="grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-2">
            {groups.map((group) => (
                <section key={group.key} className="min-w-0">
                    <h4 className="text-body font-medium text-ink">
                        {group.title}
                        <span className="ml-2 text-ink-3 tabular-nums">
                            {group.items.length}
                        </span>
                    </h4>
                    <p className="mt-0.5 text-label text-ink-3">{group.hint}</p>

                    <ul className="mt-3 divide-y divide-line-soft border-y border-line-soft">
                        {group.items.slice(0, SHOWN).map((detection) => (
                            <li key={detection.id}>
                                <Link
                                    to={`/app/detection/${detection.id}`}
                                    className={cn(
                                        "group flex items-center gap-3 py-2.5 transition-colors",
                                        "hover:bg-inset/60",
                                    )}
                                >
                                    <span className="min-w-0 flex-1 truncate text-body text-ink">
                                        {detection.patientName}
                                    </span>
                                    <span className="hidden shrink-0 text-label text-ink-3 tabular-nums sm:block">
                                        {formatDate(detection.date)}
                                    </span>
                                    <span className="w-20 shrink-0 text-right text-label text-ink-2 tabular-nums">
                                        {formatRisk(detection.risk)}
                                        <span className="text-ink-3"> risk</span>
                                    </span>
                                    <span className="shrink-0">
                                        {detection.flagged ? (
                                            <Chip tone="urgent">Flagged</Chip>
                                        ) : (
                                            <Chip tone="neutral">Not flagged</Chip>
                                        )}
                                    </span>
                                    <ChevronRight
                                        className="size-4 shrink-0 text-ink-3 transition-colors group-hover:text-ink"
                                        aria-hidden
                                    />
                                </Link>
                            </li>
                        ))}
                    </ul>

                    {group.items.length > SHOWN && (
                        <Link
                            to={group.to}
                            className="mt-2 inline-block text-label text-ink-3 transition-colors hover:text-ink"
                        >
                            Show all {group.items.length} →
                        </Link>
                    )}
                </section>
            ))}
        </div>
    );
}
