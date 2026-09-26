import { motion, type Variants } from "framer-motion";

const fadeUp: Variants = {
    hidden: { opacity: 0, y: 28 },
    show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] } },
};

export default function Problem() {
    return (
        <section id="problem" className="relative mx-auto max-w-4xl px-6 pb-12 pt-32">
            <motion.div
                initial="hidden"
                whileInView="show"
                viewport={{ once: true, amount: 0.4 }}
                variants={fadeUp}
                className="text-center"
            >
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-medcity-cyan">
                    The Challenge
                </p>
                <h2 className="mt-5 text-3xl font-extrabold leading-tight tracking-tight text-white sm:text-4xl md:text-5xl">
                    A premature baby's eyes change fast.
                    <br className="hidden sm:block" /> Care shouldn't have to wait for
                    an opening.
                </h2>
                <p className="mx-auto mt-6 max-w-2xl text-balance text-lg leading-relaxed text-[#b3b3b3]">
                    Retinopathy of Prematurity can progress within days, but a trained
                    ophthalmologist isn't always in the room when it counts. Scans sit
                    in a queue. Judgment calls vary from one reader to the next. MedCity
                    puts a second, tireless set of eyes on every image, so nothing
                    waits, and nothing gets missed.
                </p>
            </motion.div>
        </section>
    );
}
