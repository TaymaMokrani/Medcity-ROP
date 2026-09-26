import type { Point } from "./how-case";

/**
 * Measuring how twisted a vessel is — both ways, so the difference can be seen.
 *
 * This is the one piece of maths the explainer runs live rather than reciting.
 * The point it has to make is not a number, it is a behaviour: the formula the
 * literature uses changes its answer when the same vessel is photographed at a
 * different size, and the corrected one does not. A number printed on a slide
 * cannot show that. A number recomputed in front of you, from the real traced
 * points of a real vessel, can.
 *
 * What the pipeline does and what this does differ in one step. `rop/features`
 * fits a B-spline through the traced points and differentiates that; here we
 * smooth the points and use a discrete curvature. The values come out close
 * but not equal, and the page says so. The behaviour under rescaling — the
 * whole point — is identical.
 */

export interface Tortuosity {
  /** Length along the vessel, in pixels. */
  length: number;
  /** Straight line from end to end. */
  chord: number;
  /** Arc divided by chord. A pure ratio, so size cannot touch it. */
  cti: number;
  /**
   * The old measure: curvature differentiated against the spline parameter,
   * which runs 0 to 1 whatever the vessel's real length. That is where the
   * length leaks in.
   */
  tParameter: number;
  /** The same thing differentiated against real distance along the vessel. */
  tArcLength: number;
  /** Multiplied back up by length cubed, which removes size entirely. */
  tDimensionless: number;
}

/** A small moving average. The pipeline fits a spline; this is its stand-in. */
function smooth(points: Point[], window = 5): Point[] {
  const half = Math.floor(window / 2);
  return points.map((_, i) => {
    let sx = 0;
    let sy = 0;
    for (let k = -half; k <= half; k += 1) {
      const j = Math.min(points.length - 1, Math.max(0, i + k));
      sx += points[j][0];
      sy += points[j][1];
    }
    return [sx / window, sy / window] as Point;
  });
}

/** Curvature at each interior point, from the circle through its neighbours. */
function curvature(points: Point[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < points.length - 1; i += 1) {
    const [ax, ay] = points[i - 1];
    const [bx, by] = points[i];
    const [cx, cy] = points[i + 1];
    const ab = Math.hypot(bx - ax, by - ay);
    const bc = Math.hypot(cx - bx, cy - by);
    const ca = Math.hypot(cx - ax, cy - ay);
    const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    out.push((2 * cross) / Math.max(ab * bc * ca, 1e-9));
  }
  return out;
}

/** Central difference of `values` against `at`, both the same length. */
function gradient(values: number[], at: number[]): number[] {
  const n = values.length;
  const out = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i += 1) {
    const lo = Math.max(0, i - 1);
    const hi = Math.min(n - 1, i + 1);
    const span = at[hi] - at[lo];
    out[i] = Math.abs(span) < 1e-12 ? 0 : (values[hi] - values[lo]) / span;
  }
  return out;
}

function trapezoid(values: number[], at: number[]): number {
  let total = 0;
  for (let i = 1; i < values.length; i += 1) {
    total += ((values[i] + values[i - 1]) / 2) * (at[i] - at[i - 1]);
  }
  return total;
}

export function measureTortuosity(points: Point[]): Tortuosity {
  const p = smooth(points);

  // Distance along the vessel at every point.
  const s: number[] = [0];
  for (let i = 1; i < p.length; i += 1) {
    s.push(s[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
  }
  const length = s[s.length - 1];
  const chord = Math.hypot(
    p[p.length - 1][0] - p[0][0],
    p[p.length - 1][1] - p[0][1],
  );

  const kappa = curvature(p);
  const sInner = s.slice(1, -1);
  // The old parameterisation: every vessel runs 0 to 1, long or short.
  const t = sInner.map((v) => v / length);

  const dkByArcLength = gradient(kappa, sInner);
  const dkByParameter = gradient(kappa, t);

  const energyArc = trapezoid(
    dkByArcLength.map((v) => v * v),
    sInner,
  );
  const energyParam = trapezoid(
    dkByParameter.map((v) => v * v),
    t,
  );

  return {
    length,
    chord,
    cti: chord > 0 ? length / chord : 0,
    tParameter: energyParam / length,
    tArcLength: energyArc / length,
    tDimensionless: length ** 3 * energyArc,
  };
}

/** A number a person can read, without nine leading zeros. */
export function formatScientific(value: number, digits = 2): string {
  if (!Number.isFinite(value) || value === 0) return "0";
  const exponent = Math.floor(Math.log10(Math.abs(value)));
  const mantissa = value / 10 ** exponent;
  return `${mantissa.toFixed(digits)} × 10${superscript(exponent)}`;
}

const SUPERSCRIPTS: Record<string, string> = {
  "-": "⁻",
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
};

function superscript(n: number): string {
  return String(n)
    .split("")
    .map((c) => SUPERSCRIPTS[c] ?? c)
    .join("");
}
