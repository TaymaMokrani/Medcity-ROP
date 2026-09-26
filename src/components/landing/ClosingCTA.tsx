import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Eye, ArrowRight } from "lucide-react";
import { isAuthenticated } from "@/lib/auth";

export default function ClosingCTA() {
    const navigate = useNavigate();
    const goToApp = () => {
        navigate(isAuthenticated() ? "/app" : "/auth");
    };

    return (
        <section className="relative px-6 py-32">
            <div className="pointer-events-none absolute left-1/2 top-1/2 h-[420px] w-[620px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-medcity-cyan/10 blur-[140px]" />

            <motion.div
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.5 }}
                transition={{ duration: 0.7 }}
                className="relative mx-auto flex max-w-xl flex-col items-center text-center"
            >
                <div className="flex size-14 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-medcity-cyan backdrop-blur-xl">
                    <Eye className="size-6" strokeWidth={1.5} />
                </div>

                <h2 className="mt-8 text-3xl font-extrabold leading-tight tracking-tight text-white sm:text-4xl">
                    Give them the clearest start.
                </h2>
                <p className="mt-4 text-lg leading-relaxed text-[#b3b3b3]">
                    Request a walkthrough and see exactly how MedCity fits into the
                    way you already work.
                </p>

                <button
                    onClick={goToApp}
                    className="mt-9 inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 text-sm font-semibold text-medcity-void shadow-[var(--shadow-medcity-cta)] transition-transform duration-300 hover:scale-[1.03] cursor-pointer"
                >
                    Request a Demo
                    <ArrowRight className="size-4" />
                </button>
            </motion.div>
        </section>
    );
}
