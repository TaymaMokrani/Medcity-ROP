import type { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { EASE, FRAME } from "./motion";
import { toPath, type Point } from "@/lib/how-case";

/**
 * The pieces every chapter of "Behind the screening" is built from.
 *
 * One stage, one caption, one way of drawing a vessel. Each chapter then does
 * only the thing that is particular to it, which is what keeps seventeen
 * animations from becoming seventeen different visual languages.
 *
 * Motion is the explanation here, not decoration — a vessel that draws itself
 * along its own length says "this was traced" in a way no static picture does.
 * So `useReducedMotion` is respected by shortening, never by removing: someone
 * who has asked for less movement still gets the finished picture.
 */

/** The dark, fixed-ratio area every chapter draws inside. */
export function Stage({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-medcity-line bg-[#04060a]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** One of the five photographs, filling the stage. */
export function Photo({
  src,
  alt,
  className,
  style,
}: {
  src: string;
  alt: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <img
      src={src}
      alt={alt}
      draggable={false}
      className={cn("absolute inset-0 size-full select-none object-cover", className)}
      style={style}
    />
  );
}

/** An SVG laid exactly over the photograph, in the photograph's coordinates. */
export function Overlay({
  children,
  viewBox = `0 0 ${FRAME.w} ${FRAME.h}`,
  className,
}: {
  children: ReactNode;
  viewBox?: string;
  className?: string;
}) {
  return (
    <svg
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid slice"
      className={cn("pointer-events-none absolute inset-0 size-full", className)}
      aria-hidden
    >
      {children}
    </svg>
  );
}

/**
 * A vessel that draws itself from one end to the other.
 *
 * `pathLength` is animated rather than a dash offset, so the speed does not
 * depend on how long the vessel happens to be and two hundred of them finish
 * together instead of trailing off.
 */
export function DrawnPath({
  points,
  d,
  delay = 0,
  duration = 0.9,
  stroke = "var(--color-medcity-cyan)",
  width = 3,
  opacity = 1,
  dash,
}: {
  points?: Point[];
  d?: string;
  delay?: number;
  duration?: number;
  stroke?: string;
  width?: number;
  opacity?: number;
  dash?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.path
      d={d ?? toPath(points ?? [])}
      fill="none"
      stroke={stroke}
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray={dash}
      initial={{ pathLength: reduce ? 1 : 0, opacity: 0 }}
      animate={{ pathLength: 1, opacity }}
      transition={{
        pathLength: { duration: reduce ? 0 : duration, delay: reduce ? 0 : delay, ease: "easeInOut" },
        opacity: { duration: 0.25, delay: reduce ? 0 : delay },
      }}
    />
  );
}

/** Something that fades and lifts into place. The page's only entrance. */
export function Rise({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0.3 : 0.6, delay: reduce ? 0 : delay, ease: EASE }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/** A row of bars, for the steps that stand in for something inside the model. */
export function Strip({
  values,
  delay = 0,
  className,
}: {
  values: number[];
  delay?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <div className={className}>
      <div className="flex h-16 items-end gap-[3px]">
        {values.map((v, i) => (
          <motion.span
            key={i}
            initial={{ scaleY: reduce ? 1 : 0.04, opacity: 0 }}
            animate={{ scaleY: v, opacity: 1 }}
            transition={{
              duration: reduce ? 0.3 : 0.5,
              delay: reduce ? 0 : delay + i * 0.012,
              ease: EASE,
            }}
            style={{ transformOrigin: "bottom" }}
            className="h-full flex-1 rounded-[2px] bg-medcity-cyan/70"
          />
        ))}
      </div>
    </div>
  );
}

/** A label above the stage, naming which half of the system we are in. */
export function PhaseTag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-medcity-line bg-white/[0.04] px-3 py-1 text-micro font-medium uppercase tracking-[0.18em] text-medcity-cyan">
      {children}
    </span>
  );
}

/** Label left, number right. For the measurements a chapter has just made. */
export function Readout({
  rows,
  className,
}: {
  rows: [label: string, value: ReactNode, tone?: "plain" | "good" | "warn"][];
  className?: string;
}) {
  return (
    <dl
      className={cn(
        "divide-y divide-medcity-line border-y border-medcity-line",
        className,
      )}
    >
      {rows.map(([label, value, tone = "plain"]) => (
        <div key={label} className="flex items-baseline justify-between gap-6 py-2">
          <dt className="text-label text-medcity-muted">{label}</dt>
          <dd
            className={cn(
              "text-right text-body tabular-nums",
              tone === "good" && "text-emerald-300",
              tone === "warn" && "text-amber-300",
              tone === "plain" && "text-medcity-ice",
            )}
          >
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A formula, set so it can be read rather than admired.
 *
 * Built by hand instead of pulling in a maths renderer: there are five
 * formulas on this page and none of them needs more than a fraction and an
 * integral sign.
 */
export function Formula({
  children,
  note,
  struck = false,
}: {
  children: ReactNode;
  note?: ReactNode;
  struck?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-3",
        struck
          ? "border-white/10 bg-white/[0.02]"
          : "border-medcity-cyan/25 bg-medcity-cyan/[0.06]",
      )}
    >
      <p
        className={cn(
          "font-mono text-body leading-relaxed",
          struck ? "text-medcity-muted line-through decoration-white/25" : "text-medcity-ice",
        )}
      >
        {children}
      </p>
      {note && (
        <p className="mt-1.5 text-micro leading-relaxed text-medcity-muted">{note}</p>
      )}
    </div>
  );
}

/** The sentence under the stage. One idea, said plainly. */
export function Caption({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p className={cn("max-w-prose text-lead leading-relaxed text-medcity-ice/85", className)}>
      {children}
    </p>
  );
}

/** Quieter than a caption. For the qualification a claim needs. */
export function Aside({ children }: { children: ReactNode }) {
  return (
    <p className="max-w-prose text-label leading-relaxed text-medcity-muted">{children}</p>
  );
}

/** A word the page leans on, marked once so it can be skimmed for. */
export function Key({ children }: { children: ReactNode }) {
  return <span className="text-medcity-cyan">{children}</span>;
}
