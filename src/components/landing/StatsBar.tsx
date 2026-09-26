import { motion } from "framer-motion";

const stats = [
    { value: "< 2 min", label: "To screen a retinal scan" },
    { value: "24/7", label: "AI availability, every shift" },
    { value: "Doctor-led", label: "You give the final diagnosis" },
    { value: "Early risk", label: "Flagged before the disease gets worse" },
];

export default function StatsBar() {
    return (
        <section className="relative border-b border-white/5 px-6 py-14">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.5 }}
                transition={{ staggerChildren: 0.1 }}
                className="mx-auto grid max-w-6xl grid-cols-2 gap-y-10 text-center sm:grid-cols-4"
            >
                {stats.map((s) => (
                    <motion.div
                        key={s.label}
                        variants={{
                            hidden: { opacity: 0, y: 16 },
                            show: { opacity: 1, y: 0, transition: { duration: 0.5 } },
                        }}
                        className="flex flex-col items-center px-3"
                    >
                        <span className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
                            {s.value}
                        </span>
                        <span className="mt-2 text-sm text-[#b3b3b3]">{s.label}</span>
                    </motion.div>
                ))}
            </motion.div>
        </section>
    );
}
