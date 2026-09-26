import { useState, useEffect, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import { getPatients, type Patient } from "@/lib/patients";
import { getDetections, type Detection } from "@/lib/detections";
import { errorMessage } from "@/lib/api";
import { summariseByPatient, summaryFor } from "@/lib/screening";
import { Band, ErrorBand, Loading, Stat } from "@/components/ui";
import { ActivityChart } from "./dashboard/ActivityChart";
import { BirthProfile, type Baby } from "./dashboard/BirthProfile";
import { Decisions } from "./dashboard/Decisions";
import { RiskDistribution } from "./dashboard/RiskDistribution";
import { RiskTrend, type Trend } from "./dashboard/RiskTrend";
import { Worklist } from "./dashboard/Worklist";
import { buildWorklist } from "./dashboard/worklist-groups";

/**
 * The unit, in the order a doctor reads it.
 *
 * The work first — the screenings waiting on a person — then the four numbers
 * the unit is judged on, then the charts that say how it got there. It used to
 * be the other way round, with the babies last and below the fold.
 *
 * Nothing here decides anything clinical. The tiers that used to sit on this
 * page, and the screening intervals printed beside them, were invented in this
 * file; they are gone.
 */
export default function Dashboard() {
    const [patients, setPatients] = useState<Patient[]>([]);
    const [detections, setDetections] = useState<Detection[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const load = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const [pList, dList] = await Promise.all([getPatients(), getDetections()]);
            setPatients(pList);
            setDetections(dList);
        } catch (e) {
            // A failed load must not read as a quiet ward. Showing "0 flagged"
            // because the network dropped is the worst thing this page can do.
            setError(errorMessage(e, "Could not load the dashboard."));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const stats = useMemo(() => {
        const summaries = summariseByPatient(detections);
        const states = patients.map((p) => summaryFor(summaries, p.id));

        const flagged = states.filter((s) => s.state === "Flagged").length;
        const uncertain = states.filter((s) => s.state === "Uncertain").length;
        const clear = states.filter((s) => s.state === "Clear").length;
        const notScreened = states.filter((s) => s.state === "Not screened").length;
        const disputed = states.filter((s) => s.disputed).length;
        const pending = detections.filter(
            (d) => (d.doctorDecision ?? "Pending") === "Pending",
        ).length;

        // Every day between the first screening and the last, quiet ones
        // included, so the axis is time rather than a list of busy days.
        const perDay = new Map<string, number>();
        detections.forEach((d) => perDay.set(d.date, (perDay.get(d.date) ?? 0) + 1));
        const days = [...perDay.keys()].sort();
        const activity: { date: string; count: number }[] = [];
        if (days.length > 0) {
            const cursor = new Date(days[0]);
            const last = new Date(days[days.length - 1]);
            while (cursor <= last && activity.length < 120) {
                const key = cursor.toISOString().split("T")[0];
                activity.push({ date: key, count: perDay.get(key) ?? 0 });
                cursor.setDate(cursor.getDate() + 1);
            }
        }

        // One risk per eye, not per screening: a baby screened on both eyes has
        // two answers, and they are often on opposite sides of the line.
        const risks = detections.flatMap((d) =>
            d.eyeResults?.length ? d.eyeResults.map((eye) => eye.risk) : [d.risk],
        );

        const babies: Baby[] = patients.map((p) => ({
            gestationalAge: p.gestationalAge,
            birthWeight: p.birthWeight,
            flagged: summaryFor(summaries, p.id).state === "Flagged",
        }));

        const byPatient = new Map<string, Trend>();
        for (const d of [...detections].sort((a, b) => a.date.localeCompare(b.date))) {
            const trend = byPatient.get(d.patientId) ?? {
                id: d.patientId,
                name: d.patientName,
                points: [],
            };
            trend.points.push({ date: d.date, risk: d.risk });
            byPatient.set(d.patientId, trend);
        }

        return {
            flagged,
            uncertain,
            clear,
            notScreened,
            disputed,
            pending,
            screened: flagged + uncertain + clear,
            activity,
            risks,
            babies,
            trends: [...byPatient.values()],
        };
    }, [patients, detections]);

    const worklist = useMemo(() => buildWorklist(detections), [detections]);



    return (
        <div className="p-6 md:p-10">
            <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-2">
                <h1 className="font-heading text-display text-ink">ROP screening</h1>
            </header>

            {error ? (
                <div className="mt-8">
                    <ErrorBand message={error} onRetry={() => void load()} />
                    <p className="mt-4 text-body text-ink-3">
                        Nothing is shown below, because a number drawn from a failed load
                        would be a number you could act on.
                    </p>
                </div>
            ) : loading ? (
                <Loading label="Loading the ward…" className="py-24" />
            ) : (
                <>
                    <div className="mt-8">
                        <Worklist groups={worklist} />
                    </div>

                    <div className="mt-10 grid grid-cols-2 gap-x-10 gap-y-8 border-y border-line py-7 lg:grid-cols-4">
                        <Stat
                            label="Patients screened"
                            value={stats.screened}
                            detail={`${stats.notScreened} not screened yet`}
                        />
                        <Stat
                            label="Patients flagged"
                            value={
                                <span className={stats.flagged > 0 ? "text-urgent" : undefined}>
                                    {stats.flagged}
                                </span>
                            }
                            detail={
                                stats.uncertain > 0
                                    ? `${stats.uncertain} more the examiner could not call`
                                    : "Your conclusion where you made one"
                            }
                        />
                        <Stat
                            label="Awaiting your conclusion"
                            value={
                                <span className={stats.pending > 0 ? "text-watch" : undefined}>
                                    {stats.pending}
                                </span>
                            }
                            detail={
                                <Link
                                    to="/app/detection?decision=Pending"
                                    className="underline-offset-4 hover:underline"
                                >
                                    Open the list
                                </Link>
                            }
                        />
                        <Stat
                            label="Model disagreed with you"
                            value={stats.disputed}
                            detail="Patients where a conclusion went the other way"
                        />
                    </div>

                    {/*
                      * Both rows share one split and one rule apiece, so the
                      * charts line up down the page and the divider between the
                      * columns is a single straight line.
                      */}
                    <section className="mt-10 border-t border-line pt-7">
                        <div className="grid grid-cols-1 gap-x-10 lg:grid-cols-12">
                            <Band
                                flush
                                className="lg:col-span-7"
                                title="Screening activity"
                                meta="Screenings recorded per day"
                            >
                                <ActivityChart data={stats.activity} />
                            </Band>

                            <Band
                                flush
                                className="lg:col-span-5 lg:border-l lg:border-line lg:pl-10"
                                title="Conclusions"
                                meta="What the screenings came to"
                            >
                                <Decisions detections={detections} />
                            </Band>
                        </div>
                    </section>

                    <section className="mt-10 border-t border-line pt-7">
                        <div className="grid grid-cols-1 gap-x-10 lg:grid-cols-12">
                            <Band
                                flush
                                className="lg:col-span-7"
                                title="Risk distribution"
                                meta="Eyes scored, by risk"
                            >
                                <RiskDistribution risks={stats.risks} />
                            </Band>

                            <Band
                                flush
                                className="lg:col-span-5 lg:border-l lg:border-line lg:pl-10"
                                title="Risk over time"
                                meta="Each baby, screening by screening"
                            >
                                <RiskTrend series={stats.trends} />
                            </Band>
                        </div>
                    </section>

                    <Band
                        title="Patient metadata distribution"
                        meta=""
                    >
                        <BirthProfile babies={stats.babies} />
                    </Band>
                </>
            )}
        </div>
    );
}
