import { motion, useReducedMotion, type Variants } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { ArrowRight, ChevronDown } from "lucide-react";
import { isAuthenticated } from "@/lib/auth";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const LINE_ONE = ["Protecting", "every"];
const LINE_TWO = ["fragile"];

export default function Hero() {
  const navigate = useNavigate();
    const reduce = useReducedMotion();

    const goToApp = () => {
        navigate(isAuthenticated() ? "/app" : "/auth");
    };

    const container: Variants = {
        hidden: {},
        show: { transition: { staggerChildren: 0.06, delayChildren: 0.5 } },
    };
    const word: Variants = reduce
        ? { hidden: { opacity: 0 }, show: { opacity: 1, transition: { duration: 0.5 } } }
        : {
              hidden: { opacity: 0, y: 24 },
              show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE } },
          };

    const fade = (delay: number) =>
        reduce
            ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.5, delay: delay * 0.6 } }
            : {
                  initial: { opacity: 0, y: 16 },
                  animate: { opacity: 1, y: 0 },
                  transition: { duration: 0.8, delay, ease: EASE },
              };

    return (
        <section className="relative flex min-h-dvh flex-col overflow-hidden bg-medcity-void">
            <motion.img
                src="/blue_bg_effect.png"
                alt=""
                aria-hidden
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.5 }}
                transition={{ duration: 1.8, ease: "easeOut" }}
                className="pointer-events-none absolute inset-0 h-full w-full translate-x-[10%] object-cover mix-blend-screen"
            />

            <motion.div
                initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
                animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1 }}
                transition={{ duration: 1.6, delay: 0.05, ease: EASE }}
                className="pointer-events-none absolute inset-0 translate-x-[16%]"
            >
                <div
                    className="medcity-halo absolute left-1/2 top-1/2 h-[80vh] w-[80vh] -translate-x-1/2 -translate-y-1/2"
                    style={{ animation: "medcity-halo-pulse 7s ease-in-out infinite" }}
                />
                <video
                    autoPlay
                    loop
                    muted
                    playsInline
                    src="/eye_animation1.mp4"
                    className="relative h-full w-full object-cover"
                    style={{ mixBlendMode: "screen" }}
                />
            </motion.div>

            <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-medcity-void via-medcity-void/60 to-transparent" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-medcity-void to-transparent" />

            <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-7xl items-center px-6 sm:px-10">
                <div className="max-w-2xl">
                    <motion.h1
                        variants={container}
                        initial="hidden"
                        animate="show"
                        className="text-[clamp(2.5rem,6vw,4.5rem)] font-semibold leading-[1.04] tracking-[-0.02em] text-medcity-ice"
                    >
                        <span className="block">
                            {LINE_ONE.map((w, i) => (
                                <motion.span key={i} variants={word} className="mr-[0.26em] inline-block last:mr-0">
                                    {w}
                                </motion.span>
                            ))}
                        </span>
                        <span className="block">
                            {LINE_TWO.map((w, i) => (
                                <motion.span key={i} variants={word} className="mr-[0.26em] inline-block">
                                    {w}
                                </motion.span>
                            ))}
                            <motion.span
                                variants={word}
                                className="inline-block text-medcity-cyan"
                                style={{ filter: "drop-shadow(0 0 26px rgba(56,189,248,0.4))" }}
                            >
                                eye
                            </motion.span>
                        </span>
                    </motion.h1>

                    <motion.p
                        {...fade(1.1)}
                        className="mt-6 max-w-lg text-balance text-base leading-relaxed text-medcity-muted sm:text-lg"
                    >
                        We help ophthalmologists make faster, more confident decisions with
                        AI-assisted Retinopathy of Prematurity detection and severity
                        assessment for newborns.
                    </motion.p>

                    <motion.div {...fade(1.3)} className="mt-9">
                        <button
                            onClick={goToApp}
                            className="group inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.07] px-7 py-3.5 text-[0.95rem] font-medium text-medcity-ice backdrop-blur-md transition-all duration-300 hover:border-white/25 hover:bg-white/[0.12] cursor-pointer"
                        >
                            Get Started
                            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                        </button>
                    </motion.div>
                </div>
            </div>

            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1.9, duration: 0.8 }}
                className="absolute bottom-6 left-1/2 z-10 hidden -translate-x-1/2 sm:block"
            >
                <motion.div
                    animate={reduce ? {} : { y: [0, 7, 0] }}
                    transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                >
                    <ChevronDown className="size-5 text-medcity-ice/25" />
                </motion.div>
            </motion.div>
        </section>
    );
}
