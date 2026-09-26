import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  FRONT_PHOTO,
  RAW_PHOTOS,
  rescale,
  toPath,
  type Point,
} from "@/lib/how-case";
import { formatScientific, measureTortuosity } from "@/lib/tortuosity";
import {
  Aside,
  Caption,
  DrawnPath,
  Formula,
  Key,
  Overlay,
  Photo,
  Readout,
  Stage,
} from "./primitives";
import { EASE } from "./motion";
import type { Chapter } from "./types";

/**
 * Phase 2 — from vessels to a severity.
 *
 * Every picture in this half is the real thing. The vessel outlines are the
 * two hundred longest segments this pipeline traced in photograph L_00; the
 * disc, the rings and the quadrant numbers are the ones it measured; the map
 * and the vascular front are the images it rendered. The one chapter that
 * computes rather than replays — the tortuosity fix — says so and does the
 * arithmetic in the browser, in front of you.
 */

/** A viewBox that fits a centred polyline with a little room around it. */
function boundsOf(points: Point[], pad = 20) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  return {
    viewBox: `${minX} ${minY} ${Math.max(...xs) - minX + pad} ${Math.max(...ys) - minY + pad}`,
  };
}

/** Unit normal and curvature at one point, for drawing the bending circle. */
function osculating(points: Point[], i: number) {
  const [ax, ay] = points[i - 1];
  const [bx, by] = points[i];
  const [cx, cy] = points[i + 1];
  const ab = Math.hypot(bx - ax, by - ay);
  const bc = Math.hypot(cx - bx, cy - by);
  const ca = Math.hypot(cx - ax, cy - ay);
  const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const kappa = (2 * cross) / Math.max(ab * bc * ca, 1e-9);
  if (!Number.isFinite(kappa) || Math.abs(kappa) < 1e-6) return null;

  const radius = 1 / Math.abs(kappa);
  // Tangent, then its perpendicular, pointing the way the curve bends.
  const tx = (cx - ax) / Math.max(ca, 1e-9);
  const ty = (cy - ay) / Math.max(ca, 1e-9);
  const sign = Math.sign(kappa) || 1;
  return {
    cx: bx - ty * radius * sign,
    cy: by + tx * radius * sign,
    r: radius,
    at: [bx, by] as Point,
  };
}

// ----------------------------------------------------------------- 10. vessels
const vessels: Chapter = {
  id: "vessels",
  phase: "two",
  short: "Tracing vessels",
  title: "A model marks every vessel it can see",
  measured: true,
  Stage: ({ data }) => (
    <Stage>
      <Photo src={RAW_PHOTOS[0]} alt="The photograph being measured" className="opacity-70" />
      <Overlay>
        {data.vessels.map((points, i) => (
          <DrawnPath
            key={i}
            points={points}
            delay={0.2 + i * 0.004}
            duration={0.7}
            width={3.5}
            opacity={0.95}
          />
        ))}
      </Overlay>
    </Stage>
  ),
  Body: ({ data }) => (
    <>
      <Caption>
        The photograph is scanned at several sizes at once — small vessels show
        up at one scale, the big arcades at another — and the results are
        merged. What you are watching is the real trace of this photograph.
      </Caption>
      <Readout
        rows={[
          ["Vessel pixels found", data.diagnostics.vesselPx.toLocaleString("en-GB")],
          ["Separate vessel pieces", data.segmentCount.toLocaleString("en-GB")],
          ["Drawn here", `the ${data.vessels.length} longest`],
        ]}
      />
    </>
  ),
};

// --------------------------------------------------------------- 12. curvature
const curvature: Chapter = {
  id: "curvature",
  phase: "two",
  short: "Bending",
  title: "How tightly does it bend?",
  measured: true,
  Stage: ({ data }) => {
    const pts = useMemo(() => rescale(data.hero.polyline, 1), [data.hero.polyline]);
    const circles = useMemo(
      () =>
        [14, 30, 46]
          .map((i) => osculating(pts, i))
          .filter((c): c is NonNullable<typeof c> => c !== null && c.r < 400),
      [pts],
    );
    const { viewBox } = useMemo(() => boundsOf(pts, 60), [pts]);

    return (
      <Stage className="bg-[#05070c]">
        <svg viewBox={viewBox} className="absolute inset-0 size-full p-6">
          <DrawnPath points={pts} duration={1.3} delay={0.2} width={4} />
          {circles.map((c, i) => (
            <motion.g
              key={i}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 1.5 + i * 0.35 }}
            >
              <circle
                cx={c.cx}
                cy={c.cy}
                r={c.r}
                fill="none"
                stroke="rgba(56,189,248,0.35)"
                strokeWidth={1.5}
                strokeDasharray="5 5"
              />
              <circle cx={c.at[0]} cy={c.at[1]} r={3} fill="var(--color-medcity-cyan)" />
            </motion.g>
          ))}
        </svg>
        <p className="absolute bottom-4 left-4 rounded-md bg-black/65 px-2.5 py-1 text-label text-medcity-ice backdrop-blur">
          one real vessel · segment {data.hero.id} · {data.hero.quadrant} quadrant
        </p>
      </Stage>
    );
  },
  Body: ({ data }) => (
    <>
      <Caption>
        At every point along the vessel we fit the circle that hugs it there. A
        <Key> wide circle</Key> means the vessel is nearly straight. A tight one
        means it is bending hard. Twistiness is built out of those.
      </Caption>
      <Readout
        rows={[
          ["Length along this vessel", `${data.hero.lengthPx.toFixed(1)} px`],
          ["Arc divided by straight line", data.hero.cti.toFixed(4)],
          ["Which quadrant it sits in", data.hero.quadrant],
        ]}
      />
    </>
  ),
};

// ----------------------------------------------------------------- 14. caliber
const caliber: Chapter = {
  id: "caliber",
  phase: "two",
  short: "Width",
  title: "And how wide is it?",
  measured: true,
  Stage: ({ data }) => {
    const pts = useMemo(() => rescale(data.hero.polyline, 1), [data.hero.polyline]);
    const { viewBox } = useMemo(() => boundsOf(pts, 40), [pts]);
    const half = data.hero.diameterPx / 2;

    const ticks = useMemo(() => {
      const out: { x1: number; y1: number; x2: number; y2: number }[] = [];
      for (let i = 2; i < pts.length - 2; i += 2) {
        const [ax, ay] = pts[i - 1];
        const [cx, cy] = pts[i + 1];
        const len = Math.hypot(cx - ax, cy - ay) || 1;
        const nx = -(cy - ay) / len;
        const ny = (cx - ax) / len;
        const [bx, by] = pts[i];
        out.push({
          x1: bx - nx * half * 1.6,
          y1: by - ny * half * 1.6,
          x2: bx + nx * half * 1.6,
          y2: by + ny * half * 1.6,
        });
      }
      return out;
    }, [pts, half]);

    return (
      <Stage className="bg-[#05070c]">
        <svg viewBox={viewBox} className="absolute inset-0 size-full p-6">
          <path
            d={toPath(pts)}
            fill="none"
            stroke="var(--color-medcity-cyan)"
            strokeWidth={data.hero.diameterPx}
            strokeLinecap="round"
            opacity={0.18}
          />
          <DrawnPath points={pts} duration={1} delay={0.15} width={2} />
          {ticks.map((t, i) => (
            <motion.line
              key={i}
              x1={t.x1}
              y1={t.y1}
              x2={t.x2}
              y2={t.y2}
              stroke="var(--color-medcity-ice)"
              strokeWidth={1.2}
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.75 }}
              transition={{ duration: 0.3, delay: 1.1 + i * 0.035 }}
            />
          ))}
        </svg>
      </Stage>
    );
  },
  Body: ({ data }) => (
    <>
      <Caption>
        Width is measured across the vessel at many points, not one. Then the{" "}
        <Key>middle value</Key> is taken, so a single bad spot — where two
        vessels cross, say — cannot decide the answer.
      </Caption>
      <Readout
        rows={[
          ["Places measured along this vessel", data.hero.nCrossSections],
          ["Middle width", `${data.hero.diameterPx.toFixed(2)} px`],
          ["Widest tenth", `${data.hero.diameterP90Px.toFixed(2)} px`],
        ]}
      />
      <Aside>
        The old code sampled a random third of the points, with a different
        draw for every vessel length, so the same photograph measured twice
        could disagree with itself. It now measures at a fixed stride.
      </Aside>
    </>
  ),
};

// ------------------------------------------------------------------ 13. the fix
const bugfix: Chapter = {
  id: "bugfix",
  phase: "two",
  short: "Calculations",
  title: "The usual formula was measuring the wrong thing",
  measured: true,
  Stage: ({ data }) => {
    const big = useMemo(() => rescale(data.hero.polyline, 1), [data.hero.polyline]);
    const small = useMemo(() => rescale(data.hero.polyline, 0.4), [data.hero.polyline]);
    const mBig = useMemo(() => measureTortuosity(big), [big]);
    const mSmall = useMemo(() => measureTortuosity(small), [small]);
    const { viewBox } = useMemo(() => boundsOf(big, 70), [big]);

    const panel = (
      label: string,
      points: Point[],
      m: ReturnType<typeof measureTortuosity>,
      delay: number,
    ) => (
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay, ease: EASE }}
        className="flex flex-1 flex-col items-center gap-2"
      >
        <p className="text-micro uppercase tracking-[0.16em] text-medcity-muted">{label}</p>
        <svg viewBox={viewBox} className="h-28 w-full">
          <path
            d={toPath(points)}
            fill="none"
            stroke="var(--color-medcity-cyan)"
            strokeWidth={4}
            strokeLinecap="round"
          />
        </svg>
        <p className="text-micro tabular-nums text-medcity-muted">
          {m.length.toFixed(0)} px long
        </p>
        <div className="w-full space-y-1.5 px-2">
          <div className="flex items-baseline justify-between gap-2 rounded-md bg-white/[0.03] px-2.5 py-1.5">
            <span className="text-micro text-medcity-muted">old</span>
            <span className="text-label tabular-nums text-amber-300">
              {formatScientific(m.tParameter)}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-2 rounded-md bg-medcity-cyan/10 px-2.5 py-1.5">
            <span className="text-micro text-medcity-muted">fixed</span>
            <span className="text-label tabular-nums text-medcity-cyan">
              {m.tDimensionless.toFixed(1)}
            </span>
          </div>
        </div>
      </motion.div>
    );

    return (
      <Stage className="bg-[#05070c]">
        <div className="absolute inset-0 flex items-center gap-4 px-6 py-5">
          {panel("as photographed", big, mBig, 0.3)}
          <div className="h-32 w-px shrink-0 bg-medcity-line" />
          {panel("same vessel, smaller", small, mSmall, 0.7)}
        </div>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 1.5 }}
          className="absolute inset-x-6 bottom-3 text-center text-micro text-medcity-muted"
        >
          identical shape · computed in your browser from the traced points
        </motion.p>
      </Stage>
    );
  },
  Body: ({ data }) => {
    const big = rescale(data.hero.polyline, 1);
    const small = rescale(data.hero.polyline, 0.4);
    const ratio =
      measureTortuosity(small).tParameter / measureTortuosity(big).tParameter;

    return (
      <>
        <Caption>
          Here is the same vessel twice — identical shape, one photographed
          smaller. The published formula gives two answers{" "}
          <Key>{ratio.toFixed(0)} times apart</Key>. It was never measuring
          twistiness. It was measuring length in disguise.
        </Caption>
        <Formula struck note="differentiated against a parameter that runs 0 → 1 no matter how long the vessel is">
          T = (1 / L) ∫ (dκ / dt)² dt
        </Formula>
        <Formula note="differentiated against real distance along the vessel, then scaled so size drops out entirely">
          T = L³ ∫ (dκ / ds)² ds
        </Formula>
        <Aside>
          We found this while rebuilding the biomarkers, and it mattered: the
          broken version made the top-tortuosity features rank vessels mostly by
          how long they were. The numbers above are recomputed live; the
          pipeline fits a spline where this smooths, so they are close rather
          than equal. The behaviour — that one moves and the other does not — is
          the same.
        </Aside>
      </>
    );
  },
};

// ------------------------------------------------------------------- 17. front
const front: Chapter = {
  id: "front",
  phase: "two",
  short: "Zones",
  title: "How far had the vessels grown?",
  measured: true,
  Stage: () => (
    <Stage>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1, delay: 0.2 }}
        className="absolute inset-0"
      >
        <Photo src={FRONT_PHOTO} alt="How far the vessels reached, in every direction" />
      </motion.div>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 1.2, ease: EASE }}
        className="absolute inset-x-3 bottom-3 flex flex-wrap gap-x-4 gap-y-1 rounded-lg border border-medcity-line bg-black/70 px-3 py-2 backdrop-blur"
      >
        <span className="flex items-center gap-1.5 text-micro text-medcity-ice/80">
          <span className="h-0.5 w-4 rounded bg-emerald-400" /> we know where they stopped
        </span>
        <span className="flex items-center gap-1.5 text-micro text-medcity-ice/80">
          <span className="h-0.5 w-4 rounded bg-amber-400" /> they ran off the picture
        </span>
      </motion.div>
    </Stage>
  ),
  Body: ({ data }) => (
    <>
      <Caption>
        In twelve directions from the disc, the system looks for where the
        vessels stop. On this eye it could verify{" "}
        <Key>
          {data.result.zone.directions_verified} of{" "}
          {data.result.zone.directions_verified + data.result.zone.directions_unknown}
        </Key>
        . In the rest, the vessels simply ran off the edge of the photograph.
      </Caption>
      <Readout
        rows={[
          ["Vessels reached", `Zone ${data.result.zone.vessels_reached_zone}`],
          ["Furthest from the disc", `${data.result.zone.vessels_reached_dd} disc diameters`],
          [
            "Least developed verified direction",
            `Zone ${data.result.zone.most_posterior_zone}`,
          ],
        ]}
      />
      <Aside>
        Across the archive, vessels ran past the edge of the frame 95% of the
        time. When that happens the honest answer is{" "}
        <Key>not assessable</Key> — and that is what comes back, never a guess
        and never a reassuring silence. The fix is on the camera side: spread
        the five shots, push to the periphery, and make one disc-centred.
      </Aside>
    </>
  ),
};

// ------------------------------------------------------------------- 18. grade
const grade: Chapter = {
  id: "grade",
  phase: "two",
  short: "ICROP severity",
  title: "Two answers, side by side",
  measured: true,
  Stage: ({ data }) => {
    const plus = data.result.plus;
    return (
      <Stage className="bg-[#05070c]">
        <div className="absolute inset-0 flex flex-col justify-center gap-4 px-7">
          <div className="grid grid-cols-2 gap-3">
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2, ease: EASE }}
              className="rounded-xl border border-medcity-line bg-white/[0.03] p-4"
            >
              <p className="text-micro uppercase tracking-[0.16em] text-medcity-muted">
                The clock-face rule
              </p>
              <p className="mt-2 font-heading text-title text-medcity-ice">
                {plus.nAbnormalQuadrants} of {plus.nQuadrantsMeasured} quadrants
              </p>
              <p className="mt-1 text-micro text-medcity-muted">
                the official definition · kept visible
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.4, ease: EASE }}
              className="rounded-xl border border-medcity-cyan/30 bg-medcity-cyan/[0.07] p-4"
            >
              <p className="text-micro uppercase tracking-[0.16em] text-medcity-cyan">
                The continuous score
              </p>
              <p className="mt-2 font-heading text-title tabular-nums text-medcity-ice">
                {plus.cti.value.toFixed(4)}
              </p>
              <p className="mt-1 text-micro text-medcity-muted">
                cut-off {plus.cti.threshold.toFixed(4)} · leads
              </p>
            </motion.div>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.7, ease: EASE }}
            className="rounded-xl border border-rose-400/30 bg-rose-400/10 p-5"
          >
            <p className="font-heading text-display capitalize leading-none text-rose-200">
              {data.result.severity}
            </p>
            <p className="mt-2 text-body text-rose-200/85">{data.result.action}</p>
          </motion.div>
        </div>
      </Stage>
    );
  },
  Body: ({ data }) => (
    <>
      <Caption>
        The clock-face count is the official clinical definition, so it is
        always shown. But on its own it catches about a third of plus disease,
        so the <Key>continuous score leads</Key> and the count stands beside it
        as the explanation a doctor can read.
      </Caption>
      <Readout
        rows={[
          ["Zone", `${data.result.icrop.zone?.value ?? "not assessable"} · measured`],
          ["Plus", `${data.result.plus.grade} · measured`],
          ["Stage", "not measured · for the examining doctor"],
        ]}
      />
      <Aside>
        Stage depends on the ridge and on new vessel growth, which this
        pipeline does not detect. It comes back empty rather than guessed.{" "}
        {data.result.provisionalNote}
      </Aside>
    </>
  ),
};

export const PHASE_TWO: Chapter[] = [
  vessels,
  curvature,
  caliber,
  bugfix,
  front,
  grade,
];
