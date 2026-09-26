import { useRef, useState } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

const QUESTIONS = [
    {
        q: "Does MedCity replace the ophthalmologist?",
        a: "No. It gives an estimate and the measurements behind it. The doctor looks at the evidence and makes the final diagnosis. Every result is marked provisional.",
    },
    {
        q: "What does it need from me?",
        a: "Retinal photos of each eye, the baby's gestational age at birth, and their age in weeks. The Vessel Workspace takes one to five photos per eye. More angles give a joined map and a zone measurement.",
    },
    {
        q: "What does the risk number mean?",
        a: "It is the model's estimate that an eye has ROP, from 0 to 100%. It helps you decide which eyes to look at first. It is not a stage.",
    },
    {
        q: "How are the vessels measured?",
        a: "Each vessel is traced, then measured for width, length and tortuosity. Tortuosity uses two numbers: CTI, the vessel's length divided by the straight distance between its ends, and its curvature. The color follows whichever of the two is higher.",
    },
    {
        q: "How accurate are the zones?",
        a: "They are approximate. The rings are drawn from the size of the optic disc, so they are only as good as the disc detection. When a zone cannot be assessed, the app says so instead of guessing.",
    },
    {
        q: "Is it validated for clinical use?",
        a: "Not yet. The plus disease measure was tested on 633 eye visits from 255 patients and reached a sensitivity of 0.89. Its labels came from a single grader. MedCity is a research tool, not a certified medical device.",
    },
    {
        q: "Who can see patient data?",
        a: "Only signed-in accounts. Patients, photos and results all sit behind a login on the MedCity server.",
    },
];

export default function FAQ() {
    const [open, setOpen] = useState(0);
    const sectionRef = useRef<HTMLElement>(null);

    return (
        <section id="faq" ref={sectionRef} className="relative px-6 py-32">
            <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
                <div className="absolute left-[8%] top-1/2 h-[45vh] w-[45vw] -translate-y-1/2 rounded-full bg-medcity-cyan/[0.06] blur-[150px]" />
                {/* the words keep a dark, even ground to sit on */}
                <div className="absolute inset-0 bg-medcity-void/45" />
                <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-medcity-void to-transparent" />
                <div className="absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-medcity-void to-transparent" />
            </div>

            <div className="relative mx-auto grid max-w-6xl gap-12 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)] lg:gap-20">
                <motion.div
                    initial={{ opacity: 0, y: 24 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, amount: 0.5 }}
                    transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                    className="lg:sticky lg:top-32 lg:self-start"
                >
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-medcity-cyan">
                        Questions
                    </p>
                    <h2 className="mt-4 text-[clamp(1.9rem,3.2vw,2.5rem)] font-semibold leading-[1.1] tracking-[-0.02em] text-medcity-ice">
                        What doctors ask us.
                    </h2>
                    <p className="mt-4 max-w-sm text-base leading-relaxed text-medcity-muted">
                        Straight answers about what MedCity does, what it needs, and where
                        its limits are.
                    </p>
                </motion.div>

                <motion.ul
                    initial={{ opacity: 0, y: 24 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, amount: 0.2 }}
                    transition={{ duration: 0.7, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
                    className="border-t border-white/10"
                >
                    {QUESTIONS.map((item, i) => {
                        const isOpen = open === i;
                        return (
                            <li key={item.q} className="border-b border-white/10">
                                <button
                                    type="button"
                                    onClick={() => setOpen(isOpen ? -1 : i)}
                                    aria-expanded={isOpen}
                                    className="group flex w-full cursor-pointer items-center justify-between gap-6 py-6 text-left"
                                >
                                    <span
                                        className={cn(
                                            "text-lg font-medium tracking-[-0.01em] transition-colors duration-300",
                                            isOpen ? "text-medcity-ice" : "text-medcity-ice/75 group-hover:text-medcity-ice",
                                        )}
                                    >
                                        {item.q}
                                    </span>
                                    <span
                                        className={cn(
                                            "flex size-8 shrink-0 items-center justify-center rounded-full border transition-all duration-300",
                                            isOpen
                                                ? "rotate-45 border-medcity-cyan/40 text-medcity-cyan"
                                                : "border-white/10 text-medcity-muted group-hover:border-white/25",
                                        )}
                                    >
                                        <Plus className="size-4" strokeWidth={1.5} aria-hidden />
                                    </span>
                                </button>
                                <div
                                    className={cn(
                                        "grid transition-[grid-template-rows,opacity] duration-500 ease-out",
                                        isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
                                    )}
                                >
                                    <div className="overflow-hidden">
                                        <p className="max-w-2xl pb-6 pr-14 text-base leading-relaxed text-medcity-muted">
                                            {item.a}
                                        </p>
                                    </div>
                                </div>
                            </li>
                        );
                    })}
                </motion.ul>
            </div>
        </section>
    );
}
