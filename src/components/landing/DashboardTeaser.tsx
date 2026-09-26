import { useRef } from "react";
import { motion, useScroll, useTransform } from "framer-motion";

export default function DashboardTeaser() {
    const stageRef = useRef<HTMLDivElement>(null);

    const { scrollYProgress } = useScroll({
        target: stageRef,
        offset: ["start start", "end end"],
    });

    const rotateX = useTransform(scrollYProgress, [0, 0.6], [26, 0]);
    const scale = useTransform(scrollYProgress, [0, 0.6], [0.68, 1]);

    return (
        <section id="dashboard" ref={stageRef} className="relative h-[170vh]">
            <div className="sticky top-0 flex h-screen flex-col items-center justify-center overflow-hidden px-6">
                <div className="pointer-events-none absolute left-1/2 top-[58%] h-[52vh] w-[68vw] -translate-x-1/2 -translate-y-1/2 rounded-full bg-medcity-cyan/10 blur-[130px]" />

                <div className="relative z-10 max-w-2xl px-6 text-center">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-medcity-cyan">
                        Unified Workspace
                    </p>
                    <h2 className="mt-4 text-[clamp(1.9rem,3.2vw,2.5rem)] font-semibold leading-[1.1] tracking-[-0.02em] text-medcity-ice">
                        One dashboard. Every screening, in view.
                    </h2>
                    <p className="mt-4 text-base leading-relaxed text-medcity-muted">
                        From intake to AI screening to follow-up — every case you
                        screen, gathered in a single view.
                    </p>
                </div>

                <div className="mt-10 w-full max-w-3xl" style={{ perspective: 1600 }}>
                    <motion.div
                        style={{ scale, rotateX, transformOrigin: "top center" }}
                        className="relative rounded-[1.4rem] border border-white/10 bg-white/[0.04] p-2 shadow-[0_50px_140px_-24px_rgba(0,0,0,0.75)] backdrop-blur-sm transform-gpu will-change-transform"
                    >
                        <div className="pointer-events-none absolute inset-x-0 top-0 h-px rounded-t-[1.4rem] bg-gradient-to-r from-transparent via-white/25 to-transparent" />
                        <img
                            src="/dashboard_draft.png"
                            alt="MedCity ROP dashboard preview"
                            className="w-full rounded-[1rem] border border-white/10 bg-medcity-surface object-cover"
                        />
                    </motion.div>
                </div>
            </div>
        </section>
    );
}
