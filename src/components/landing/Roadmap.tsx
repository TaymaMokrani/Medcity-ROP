import { motion } from "framer-motion";

const VB = { w: 1600, h: 720 };

type Pt = { x: number; y: number };

const P0 = { x: 210, y: 110 };
const C1 = { x: 110, y: 450 };
const C2 = { x: 1180, y: 470 };
const P3 = { x: 1470, y: 645 };

const CURVE = `M ${P0.x} ${P0.y} C ${C1.x} ${C1.y}, ${C2.x} ${C2.y}, ${P3.x} ${P3.y}`;

const cubicAt = (t: number): Pt => {
    const u = 1 - t;
    return {
        x: u * u * u * P0.x + 3 * u * u * t * C1.x + 3 * u * t * t * C2.x + t * t * t * P3.x,
        y: u * u * u * P0.y + 3 * u * u * t * C1.y + 3 * u * t * t * C2.y + t * t * t * P3.y,
    };
};

const curveYAtX = (targetX: number): number => {
    let y = 0;
    let prev = cubicAt(0);
    for (let i = 1; i <= 600; i++) {
        const cur = cubicAt(i / 600);
        if ((prev.x - targetX) * (cur.x - targetX) <= 0 && prev.x !== cur.x) {
            const f = (targetX - prev.x) / (cur.x - prev.x);
            y = prev.y + f * (cur.y - prev.y);
        }
        prev = cur;
    }
    return y;
};

const CONNECTOR_LEN = 130;

const steps = [
    {
        n: "01",
        title: "Capture the image",
        body: "Any fundus camera you already use — the scan flows straight in.",
        x: 300,
    },
    {
        n: "02",
        title: "AI screens instantly",
        body: "In seconds, MedCity flags what needs a look and clears the rest.",
        x: 620,
    },
    {
        n: "03",
        title: "Severity, mapped",
        body: "For flagged eyes, it grades how far the disease has progressed.",
        x: 940,
    },
    {
        n: "04",
        title: "You decide",
        body: "Every result comes back to you with the evidence attached.",
        x: 1240,
    },
].map((s) => {
    const contactY = curveYAtX(s.x);
    return { ...s, contactY, textTop: contactY - CONNECTOR_LEN };
});

const COMET_LAYERS = 12;
const COMET_TAIL = 0.85;
const SEG = 0.03;

const HEAD_RGB = [234, 249, 255];
const TAIL_RGB = [56, 189, 248];

const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
const cometColor = (t: number) =>
    `rgb(${lerp(HEAD_RGB[0], TAIL_RGB[0], t)}, ${lerp(
        HEAD_RGB[1],
        TAIL_RGB[1],
        t,
    )}, ${lerp(HEAD_RGB[2], TAIL_RGB[2], t)})`;

const cometLayers = Array.from({ length: COMET_LAYERS }, (_, k) => {
    const f = k / (COMET_LAYERS - 1);
    return {
        opacity: Math.pow(1 - f, 1.7),
        width: 3.2 - 2.4 * f,
        color: cometColor(f),
        delay: -COMET_TAIL + (k * COMET_TAIL) / (COMET_LAYERS - 1),
        glow: f < 0.18,
    };
});

export default function Roadmap() {
    return (
        <section id="workflow" className="relative overflow-hidden px-6 py-32">
            <motion.div
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.5 }}
                transition={{ duration: 0.7 }}
                className="relative mx-auto max-w-2xl text-center"
            >
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-medcity-cyan">
                    How It Works
                </p>
                <h2 className="mt-4 text-[clamp(1.9rem,3.2vw,2.5rem)] font-semibold leading-[1.1] tracking-[-0.02em] text-medcity-ice">
                    From capture to confidence.
                </h2>
                <p className="mt-4 text-base leading-relaxed text-medcity-muted">
                    No new workflow to learn. MedCity fits into the one you
                    already run.
                </p>
            </motion.div>

            <div className="relative mx-auto mt-1 hidden w-full max-w-[1500px] aspect-[1600/720] lg:block">
                <svg
                    className="absolute inset-0 h-full w-full"
                    viewBox={`0 0 ${VB.w} ${VB.h}`}
                    preserveAspectRatio="none"
                    fill="none"
                >
                    {steps.map((s, i) => (
                        <line
                            key={i}
                            x1={s.x}
                            y1={s.textTop}
                            x2={s.x}
                            y2={s.contactY}
                            stroke="rgba(56,189,248,0.55)"
                            strokeWidth={1}
                            strokeDasharray="4 5"
                            vectorEffect="non-scaling-stroke"
                        />
                    ))}

                    <path
                        d={CURVE}
                        stroke="#38bdf8"
                        strokeOpacity="0.3"
                        strokeWidth={2}
                        vectorEffect="non-scaling-stroke"
                        pathLength={1}
                    />

                    {cometLayers
                        .slice()
                        .reverse()
                        .map((L, i) => (
                            <path
                                key={i}
                                d={CURVE}
                                className="medcity-comet"
                                stroke={L.color}
                                strokeWidth={L.width}
                                strokeOpacity={L.opacity}
                                strokeLinecap="round"
                                vectorEffect="non-scaling-stroke"
                                pathLength={1}
                                style={{
                                    strokeDasharray: `${SEG} ${1 - SEG}`,
                                    animationDelay: `${L.delay}s`,
                                    filter: L.glow
                                        ? "drop-shadow(0 0 6px rgba(125,211,252,0.95))"
                                        : undefined,
                                }}
                            />
                        ))}
                </svg>

                {steps.map((s, i) => (
                    <motion.div
                        key={s.n}
                        initial={{ opacity: 0, y: 14 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true, amount: 0.6 }}
                        transition={{ duration: 0.6, delay: i * 0.12 }}
                        className="absolute w-[15rem] pl-4"
                        style={{
                            left: `${(s.x / VB.w) * 100}%`,
                            top: `${(s.textTop / VB.h) * 100}%`,
                        }}
                    >
                        <p className="text-[17px] font-semibold text-medcity-ice">
                            <span className="text-medcity-cyan">{s.n}</span>{" "}
                            <span className="text-medcity-muted">&middot;</span>{" "}
                            {s.title}
                        </p>
                        <p className="mt-2 text-[15px] leading-relaxed text-medcity-muted">
                            {s.body}
                        </p>
                    </motion.div>
                ))}
            </div>

            <div className="mx-auto mt-14 flex max-w-md flex-col gap-10 lg:hidden">
                {steps.map((s, i) => (
                    <motion.div
                        key={s.n}
                        initial={{ opacity: 0, x: -16 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ once: true, amount: 0.6 }}
                        transition={{ duration: 0.5, delay: i * 0.05 }}
                        className="border-l border-dashed border-medcity-cyan/40 pl-5"
                    >
                        <p className="text-[17px] font-semibold text-medcity-ice">
                            <span className="text-medcity-cyan">{s.n}</span>{" "}
                            <span className="text-medcity-muted">&middot;</span> {s.title}
                        </p>
                        <p className="mt-2 text-[15px] leading-relaxed text-medcity-muted">
                            {s.body}
                        </p>
                    </motion.div>
                ))}
            </div>
        </section>
    );
}
