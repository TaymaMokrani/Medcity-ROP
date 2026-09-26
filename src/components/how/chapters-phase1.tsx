import { motion, useReducedMotion } from "framer-motion";
import { RAW_PHOTOS } from "@/lib/how-case";
import {
  Aside,
  Caption,
  DrawnPath,
  Key,
  Photo,
  Stage,
  Strip,
} from "./primitives";
import { bars } from "./diagram";
import { EASE } from "./motion";
import type { Chapter } from "./types";

/**
 * Phase 1 — from five photographs to one risk.
 *
 * Four of these eight steps happen inside the model, where there is nothing
 * to photograph: the vector it builds and the weights it puts on each
 * photograph are not written into the evidence packet. Those are drawn as
 * diagrams and marked as diagrams. The photographs themselves are real.
 */

// ---------------------------------------------------------------- 1. arrival
const arrival: Chapter = {
  id: "photographs",
  phase: "one",
  short: "Five photographs",
  title: "It starts with five photographs of one eye",
  measured: true,
  Stage: () => (
    <Stage className="bg-[#04060a]">
      <div className="absolute inset-0 grid grid-cols-3 grid-rows-2 gap-2 p-3">
        {RAW_PHOTOS.map((src, i) => (
          <motion.div
            key={src}
            initial={{ opacity: 0, y: 18, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.6, delay: 0.1 + i * 0.12, ease: EASE }}
            className="relative overflow-hidden rounded-lg border border-medcity-line"
          >
            <Photo src={src} alt={`Photograph ${i + 1} of the left eye`} />
            <span className="absolute bottom-1.5 left-2 text-micro font-medium text-white/80">
              {i + 1}
            </span>
          </motion.div>
        ))}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.8 }}
          className="flex flex-col justify-center rounded-lg border border-dashed border-medcity-line px-4"
        >
          <p className="text-micro uppercase tracking-[0.16em] text-medcity-muted">
            Left eye
          </p>
          <p className="mt-1 text-body text-medcity-ice">One examination</p>
        </motion.div>
      </div>
    </Stage>
  ),
  Body: ({ data }) => (
    <>
      <Caption>
        A nurse photographs the back of the baby's eye with a retinal camera.
        Five pictures, one eye, taken from slightly different angles so that
        between them they cover as much of the retina as possible.
      </Caption>
      <Aside>
        Everything on this page comes from one real screening this system
        measured — {data.source.photograph} and its four companions, the left
        eye of an infant in the archive. Nothing here is drawn by hand.
      </Aside>
    </>
  ),
};

// ------------------------------------------------------------------ 4. vector
const vector: Chapter = {
  id: "vector",
  phase: "one",
  short: "Five vectors",
  title: "Each photograph becomes a list of numbers",
  measured: false,
  Stage: () => (
    <Stage>
      <div className="absolute inset-0 flex flex-col justify-center gap-3 px-8">
        {RAW_PHOTOS.map((src, i) => (
          <motion.div
            key={src}
            initial={{ opacity: 0, x: -14 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.15 + i * 0.16, ease: EASE }}
            className="flex items-center gap-4"
          >
            <span className="w-14 shrink-0 overflow-hidden rounded-md border border-medcity-line">
              <span className="block aspect-[4/3]">
                <Photo src={src} alt={`Photograph ${i + 1}`} />
              </span>
            </span>

            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.35 + i * 0.16 }}
              className="shrink-0 text-medcity-muted"
              aria-hidden
            >
              →
            </motion.span>

            <Strip
              values={bars(52, 7 + i * 13)}
              delay={0.4 + i * 0.16}
              className="min-w-0 flex-1 [&>div]:h-8"
            />
          </motion.div>
        ))}
      </div>
    </Stage>
  ),
  Body: () => (
    <>
      <Caption>
        A retina model looks at each photograph on its own and produces a list
        of numbers. Not colours or pixels — <Key>patterns</Key>. Five
        photographs give five lists.
      </Caption>
      <Aside>
        The model underneath is RETFound, trained on more than a million
        retinal images. We did not train it from nothing; we built the part
        that reads its output and decides.
      </Aside>
    </>
  ),
};

// --------------------------------------------------------------- 5. attention
const attention: Chapter = {
  id: "attention",
  phase: "one",
  short: "Which ones matter",
  title: "Some photographs carry the answer more than others",
  measured: false,
  Stage: () => {
    const weights = [0.12, 0.18, 0.41, 0.15, 0.14];
    const reduce = useReducedMotion();
    return (
      <Stage>
        <div className="absolute inset-0 flex items-end justify-center gap-4 px-8 pb-12 pt-10">
          {RAW_PHOTOS.map((src, i) => {
            const lead = weights[i] === Math.max(...weights);
            return (
              <div key={src} className="flex w-full max-w-[7.5rem] flex-col items-center gap-2">
                <motion.span
                  initial={{ height: 4 }}
                  animate={{ height: reduce ? weights[i] * 150 : [4, weights[i] * 150] }}
                  transition={{ duration: 0.8, delay: 0.5 + i * 0.1, ease: EASE }}
                  className={
                    lead
                      ? "w-full rounded-t bg-medcity-cyan"
                      : "w-full rounded-t bg-medcity-cyan/30"
                  }
                />
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 1.3 + i * 0.08 }}
                  className={
                    lead
                      ? "text-label font-medium tabular-nums text-medcity-cyan"
                      : "text-label tabular-nums text-medcity-muted"
                  }
                >
                  {Math.round(weights[i] * 100)}%
                </motion.span>
                <motion.div
                  animate={{
                    scale: lead ? 1.06 : 1,
                    opacity: lead ? 1 : 0.55,
                  }}
                  transition={{ duration: 0.6, delay: 1.4, ease: EASE }}
                  className="w-full overflow-hidden rounded-lg border border-medcity-line"
                >
                  <div className="aspect-[4/3]">
                    <Photo src={src} alt={`Photograph ${i + 1}`} />
                  </div>
                </motion.div>
              </div>
            );
          })}
        </div>
      </Stage>
    );
  },
  Body: () => (
    <>
      <Caption>
        The five lists are not simply averaged. The model decides how much
        weight to give each photograph, and the weights come out with the
        answer — so it can say <Key>which picture the risk came from</Key>.
      </Caption>
      <Aside>
        This is the part of the system that lets a doctor disagree with it. A
        risk of 98% with no idea where it came from is not something anybody can
        argue with.
      </Aside>
    </>
  ),
};

// ------------------------------------------------------------------ 6. fusion
const fusion: Chapter = {
  id: "fusion",
  phase: "one",
  short: "Data fusion",
  title: "The baby's own numbers go in beside the pictures",
  measured: false,
  Stage: () => (
    <Stage>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 px-10">
        <div className="flex w-full max-w-xl items-center gap-4">
          {[
            ["Weeks at birth", "27 + 0"],
            ["Weeks since birth", "1 + 5"],
          ].map(([label, value], i) => (
            <motion.div
              key={label}
              initial={{ opacity: 0, x: i === 0 ? -30 : 30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6, delay: 0.2 + i * 0.12, ease: EASE }}
              className="flex-1 rounded-xl border border-medcity-line bg-white/[0.03] px-4 py-3"
            >
              <p className="text-micro uppercase tracking-[0.16em] text-medcity-muted">
                {label}
              </p>
              <p className="mt-1 text-title tabular-nums text-medcity-ice">{value}</p>
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, scaleX: 0 }}
          animate={{ opacity: 1, scaleX: 1 }}
          transition={{ duration: 0.7, delay: 0.9, ease: EASE }}
          className="h-px w-full max-w-xl bg-medcity-cyan/40"
        />

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 1.1, ease: EASE }}
          className="w-full max-w-xl"
        >
          <p className="mb-2 text-center text-micro uppercase tracking-[0.16em] text-medcity-muted">
            one combined description of this eye, at this age
          </p>
          <Strip values={bars(96, 21)} delay={1.3} />
        </motion.div>
      </div>
    </Stage>
  ),
  Body: () => (
    <>
      <Caption>
        Two babies whose retinas look the same are not at the same risk if one
        was born at 25 weeks and the other at 32. So how early the baby was
        born, and how long ago, are folded into the same description.
      </Caption>
      <Aside>
        We built five different ways of folding them together and kept the one
        that worked best on held-out patients.
      </Aside>
    </>
  ),
};

// ------------------------------------------------------------- 7. calibration
const calibration: Chapter = {
  id: "calibration",
  phase: "one",
  short: "Risk percentage",
  title: "The raw score is bent onto a curve",
  measured: false,
  Stage: () => {
    // A logistic curve, drawn in its own little coordinate space.
    const curve = Array.from({ length: 60 }, (_, i) => {
      const x = (i / 59) * 300;
      const z = (x - 150) / 34;
      return `${i === 0 ? "M" : "L"}${(x + 40).toFixed(1)} ${(200 - 170 / (1 + Math.exp(-z))).toFixed(1)}`;
    }).join(" ");

    return (
      <Stage>
        <svg viewBox="0 0 400 240" className="absolute inset-0 size-full p-6">
          <line x1="40" y1="200" x2="360" y2="200" stroke="rgba(180,210,245,0.2)" />
          <line x1="40" y1="20" x2="40" y2="200" stroke="rgba(180,210,245,0.2)" />
          <text x="200" y="228" textAnchor="middle" className="fill-[#8a97a8] text-[10px]">
            raw score from the model
          </text>
          <text
            x="14"
            y="110"
            textAnchor="middle"
            transform="rotate(-90 14 110)"
            className="fill-[#8a97a8] text-[10px]"
          >
            risk in 100 babies
          </text>

          <DrawnPath d={curve} duration={1.6} delay={0.3} width={2.5} />

          <motion.g
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 2 }}
          >
            <circle cx="268" cy="43" r="6" fill="var(--color-medcity-cyan)" />
            <line
              x1="268"
              y1="43"
              x2="268"
              y2="200"
              stroke="var(--color-medcity-cyan)"
              strokeDasharray="4 4"
              strokeWidth="1.5"
              opacity="0.6"
            />
            <line
              x1="40"
              y1="43"
              x2="268"
              y2="43"
              stroke="var(--color-medcity-cyan)"
              strokeDasharray="4 4"
              strokeWidth="1.5"
              opacity="0.6"
            />
            <text x="48" y="36" className="fill-[#eaf2fb] text-[12px] font-medium">
              92%
            </text>
          </motion.g>
        </svg>
      </Stage>
    );
  },
  Body: () => (
    <>
      <Caption>
        The model's raw score is not a percentage. It is bent onto a curve so
        that when the system says <Key>20%</Key>, roughly twenty babies in every
        hundred scoring that actually have the disease.
      </Caption>
      <Aside>
        Without this step the numbers still rank babies correctly, but they do
        not mean anything on their own — and a doctor reading "20%" would be
        reading a number that was never 20 of anything.
      </Aside>
    </>
  ),
};

// --------------------------------------------------------------- 8. threshold
const threshold: Chapter = {
  id: "threshold",
  phase: "one",
  short: "The line",
  title: "Above the line, we look closer",
  measured: false,
  Stage: () => (
    <Stage>
      <div className="absolute inset-0 flex flex-col justify-center px-10">
        <div className="relative h-3 w-full overflow-hidden rounded-full bg-white/[0.06]">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: "92%" }}
            transition={{ duration: 1.4, delay: 0.3, ease: EASE }}
            className="h-full rounded-full bg-gradient-to-r from-medcity-cyan-deep to-rose-400"
          />
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.9 }}
            className="absolute inset-y-0 left-[18%] w-0.5 bg-medcity-ice"
          />
        </div>

        <div className="relative mt-2 h-10">
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1 }}
            className="absolute left-[18%] -translate-x-1/2 text-center text-micro text-medcity-muted"
          >
            the line
            <br />
            18%
          </motion.p>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 1.7, ease: EASE }}
          className="mt-6 self-start rounded-xl border border-rose-400/30 bg-rose-400/10 px-5 py-4"
        >
          <p className="font-heading text-display leading-none text-rose-200">92%</p>
          <p className="mt-2 text-label text-rose-200/80">
            flagged — this eye goes on for measuring
          </p>
        </motion.div>
      </div>
    </Stage>
  ),
  Body: () => (
    <>
      <Caption>
        One line decides who is looked at again. It sits low on purpose. A
        false alarm costs one more look by a doctor who is already standing
        there. A miss costs a baby their sight.
      </Caption>
      <Aside>
        That is the whole trade, and it is chosen deliberately rather than
        landed on. Phase 1 ends here: it says <em>look closer</em>, and never
        how bad it is.
      </Aside>
    </>
  ),
};

export const PHASE_ONE: Chapter[] = [
  arrival,
  vector,
  attention,
  fusion,
  calibration,
  threshold,
];
