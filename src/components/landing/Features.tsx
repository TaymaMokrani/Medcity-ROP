import { useRef } from "react";
import { motion, useScroll, useTransform, useSpring } from "framer-motion";
import { Eye, Gauge, Activity, TrendingUp } from "lucide-react";

const STATUS = {
    clear: { label: "Not flagged", dot: "#38bdf8" },
    mild: { label: "Flagged", dot: "#d0a85f" },
    refer: { label: "Flagged", dot: "#d76d81" },
} as const;

function StatusChip({ s }: { s: keyof typeof STATUS }) {
    const { label, dot } = STATUS[s];
    return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-xs font-medium text-white/75">
            <span className="size-1.5 rounded-full" style={{ backgroundColor: dot }} />
            {label}
        </span>
    );
}

const screenings = [
    { name: "Baby A. · Right eye", time: "Today, 9:14am", status: "clear" as const },
    { name: "Baby B. · Left eye", time: "Today, 8:52am", status: "mild" as const },
    { name: "Baby C. · Both eyes", time: "Today, 8:30am", status: "refer" as const },
];

const cardClass =
    "relative flex min-h-[520px] flex-col overflow-hidden rounded-[28px] border border-white/12 bg-white/[0.05] p-8 backdrop-blur-2xl";

function CardTint() {
    return (
        <>
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.07] to-transparent" />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-medcity-cyan/[0.09] via-transparent to-transparent" />
        </>
    );
}

export default function Features() {
    const ref = useRef<HTMLElement>(null);
    const { scrollYProgress } = useScroll({
        target: ref,
        offset: ["start end", "end start"],
    });
    const bgTarget = useTransform(scrollYProgress, [0, 0.75], [0, 0.72]);
    const bgOpacity = useSpring(bgTarget, { stiffness: 40, damping: 26, mass: 0.7 });

    const gridRef = useRef<HTMLDivElement>(null);
    const { scrollYProgress: cardsProgress } = useScroll({
        target: gridRef,
        offset: ["start end", "center center"],
    });
    const y0 = useTransform(cardsProgress, [0.0, 0.55], [40, 0]);
    const y1 = useTransform(cardsProgress, [0.12, 0.67], [60, 0]);
    const y2 = useTransform(cardsProgress, [0.24, 0.79], [80, 0]);
    const cardY = [y0, y1, y2];

    return (
        <section ref={ref} id="capabilities" className="relative overflow-hidden py-32">
            <motion.img
                src="/blue_bg_effect.png"
                alt=""
                aria-hidden
                style={{ opacity: bgOpacity }}
                className="pointer-events-none absolute inset-0 h-full w-full scale-90 object-cover mix-blend-screen"
            />
            <div
                className="pointer-events-none absolute inset-0"
                style={{
                    background:
                        "radial-gradient(ellipse 82% 72% at 55% 42%, transparent 18%, rgba(5,7,12,0.72) 66%, #05070c 100%)",
                }}
            />

            <div className="relative mx-auto max-w-7xl px-6">
                <motion.div
                    initial={{ opacity: 0, y: 24 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, amount: 0.5 }}
                    transition={{ duration: 0.7 }}
                    className="max-w-2xl"
                >
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-medcity-cyan">
                        What MedCity Does
                    </p>
                    <h2 className="mt-5 text-[clamp(2rem,4vw,3.25rem)] font-semibold leading-[1.05] tracking-[-0.02em] text-medcity-ice">
                        One system. Every stage of sight.
                    </h2>
                    <p className="mt-5 max-w-md text-lg leading-relaxed text-medcity-muted">
                        From first scan to final call — a connected view of every case,
                        guided by AI and confirmed by you.
                    </p>
                </motion.div>

                <div
                    ref={gridRef}
                    className="mt-16 grid grid-cols-1 gap-5 lg:grid-cols-3"
                >
                    <motion.div style={{ y: cardY[0] }} className={cardClass}>
                        <CardTint />
                        <div className="relative z-10 flex flex-1 flex-col">
                            <div className="flex flex-1 flex-col rounded-2xl border border-white/10 bg-black/30 p-6">
                                <div className="flex items-center justify-between">
                                    <p className="text-xs text-white/50">Right eye &middot; 29 wks</p>
                                    <span className="rounded-full bg-medcity-cyan/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-medcity-cyan">
                                        AI
                                    </span>
                                </div>
                                <div className="mt-4 flex items-center gap-2.5">
                                    <span className="size-2.5 rounded-full" style={{ backgroundColor: STATUS.mild.dot }} />
                                    <p className="text-4xl font-extrabold text-white">71%</p>
                                </div>
                                <p className="mt-1 text-xs text-white/50">Estimated ROP risk</p>
                                <div className="mt-5">
                                    <div className="flex items-center justify-between text-xs text-white/45">
                                        <span>Above the referral line</span>
                                        <span className="text-white/75">Flagged</span>
                                    </div>
                                    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10">
                                        <div className="h-full w-[71%] rounded-full bg-gradient-to-r from-medcity-cyan-deep to-medcity-cyan" />
                                    </div>
                                </div>
                                <div className="mt-5 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2.5 text-xs text-white/55">
                                    Decision support only ·{" "}
                                    <span className="text-white/85">the doctor confirms</span>
                                </div>
                                <button className="mt-auto w-full rounded-lg border border-white/15 bg-white/10 py-2 text-sm text-white/90">
                                    View Case
                                </button>
                            </div>
                            <div className="pt-8">
                                <div className="flex items-center gap-2 text-medcity-ice">
                                    <Gauge className="size-4 text-medcity-cyan" />
                                    <span className="text-xs font-semibold uppercase tracking-[0.16em]">
                                        Risk, at a glance
                                    </span>
                                </div>
                                <p className="mt-3 text-sm leading-relaxed text-white/70">
                                    One estimated risk per eye, the second a scan completes —
                                    for you to confirm.
                                </p>
                            </div>
                        </div>
                    </motion.div>

                    <motion.div style={{ y: cardY[1] }} className={cardClass}>
                        <CardTint />
                        <div className="relative z-10 flex flex-1 flex-col">
                            <div className="flex flex-1 flex-col gap-3 rounded-2xl border border-white/10 bg-black/30 p-4">
                                <div className="flex items-center justify-between px-1">
                                    <span className="text-xs font-medium text-white/55">Today</span>
                                    <span className="text-xs text-white/40">3 screenings</span>
                                </div>
                                {screenings.map((s) => (
                                    <div
                                        key={s.name}
                                        className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/[0.04] p-3"
                                    >
                                        <div className="flex items-center gap-3">
                                            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/70">
                                                <Eye className="size-4" />
                                            </span>
                                            <div>
                                                <p className="text-sm text-white">{s.name}</p>
                                                <p className="text-xs text-white/45">{s.time}</p>
                                            </div>
                                        </div>
                                        <StatusChip s={s.status} />
                                    </div>
                                ))}
                                <button className="mt-auto rounded-xl border border-white/10 bg-white/[0.03] py-2 text-xs font-medium text-white/60 transition-colors hover:text-white/90">
                                    View all screenings
                                </button>
                            </div>
                            <div className="pt-8">
                                <div className="flex items-center gap-2 text-medcity-ice">
                                    <Activity className="size-4 text-medcity-cyan" />
                                    <span className="text-xs font-semibold uppercase tracking-[0.16em]">
                                        A live feed of every screening
                                    </span>
                                </div>
                                <p className="mt-3 text-sm leading-relaxed text-white/70">
                                    See what just came in, what needs a closer look, and
                                    what's clear — the moment you upload an image.
                                </p>
                            </div>
                        </div>
                    </motion.div>

                    <motion.div style={{ y: cardY[2] }} className={cardClass}>
                        <CardTint />
                        <div className="relative z-10 flex flex-1 flex-col">
                            <div className="flex flex-1 flex-col rounded-2xl border border-white/10 bg-black/30 p-5">
                                <div className="flex items-center justify-between">
                                    <div className="rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-xs text-white shadow-lg">
                                        Week 12 &middot; 1,240 scans
                                    </div>
                                    <span className="text-xs text-white/40">+18%</span>
                                </div>
                                <svg viewBox="0 0 240 120" preserveAspectRatio="none" className="mt-8 h-40 w-full">
                                    <defs>
                                        <linearGradient id="trendStroke" x1="0" y1="0" x2="1" y2="0">
                                            <stop offset="0%" stopColor="#0ea5e9" />
                                            <stop offset="100%" stopColor="#38bdf8" />
                                        </linearGradient>
                                        <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.28" />
                                            <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
                                        </linearGradient>
                                    </defs>
                                    <polygon
                                        fill="url(#trendFill)"
                                        points="4,105 40,98 80,88 120,64 160,46 200,20 236,8 236,120 4,120"
                                    />
                                    <polyline
                                        fill="none"
                                        stroke="url(#trendStroke)"
                                        strokeWidth="3"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        vectorEffect="non-scaling-stroke"
                                        points="4,105 40,98 80,88 120,64 160,46 200,20 236,8"
                                    />
                                </svg>
                                <div className="mt-auto grid grid-cols-2 gap-3 border-t border-white/5 pt-4">
                                    <div>
                                        <p className="text-xs text-white/45">Avg turnaround</p>
                                        <p className="mt-0.5 text-sm font-semibold text-white/85">2.4 h</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-white/45">Cleared</p>
                                        <p className="mt-0.5 text-sm font-semibold text-white/85">98%</p>
                                    </div>
                                </div>
                            </div>
                            <div className="pt-8">
                                <div className="flex items-center gap-2 text-medcity-ice">
                                    <TrendingUp className="size-4 text-medcity-cyan" />
                                    <span className="text-xs font-semibold uppercase tracking-[0.16em]">
                                        Progress you can actually see
                                    </span>
                                </div>
                                <p className="mt-3 text-sm leading-relaxed text-white/70">
                                    Track volume, turnaround time, and outcomes over weeks — not
                                    just one case in isolation.
                                </p>
                            </div>
                        </div>
                    </motion.div>
                </div>
            </div>
        </section>
    );
}
