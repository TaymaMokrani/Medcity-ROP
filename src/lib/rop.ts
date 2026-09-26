/**
 * The Phase 1 risk ramp.
 *
 * Left exactly as it was, by instruction: this is the one colour scale in the
 * app that was not touched by the restyle. Everything else — states,
 * severities, conclusions — draws from the shared clinical tones.
 */
const RISK_STOPS: { at: number; rgb: [number, number, number] }[] = [
  { at: 0, rgb: [16, 185, 129] },
  { at: 25, rgb: [245, 158, 11] },
  { at: 100, rgb: [239, 68, 68] },
];

function mix(from: number, to: number, t: number): number {
  return Math.round(from + (to - from) * t);
}

export function riskColor(percent: number): string {
  const p = Math.min(100, Math.max(0, Number.isFinite(percent) ? percent : 0));

  let lower = RISK_STOPS[0];
  let upper = RISK_STOPS[RISK_STOPS.length - 1];
  for (let i = 0; i < RISK_STOPS.length - 1; i++) {
    if (p >= RISK_STOPS[i].at && p <= RISK_STOPS[i + 1].at) {
      lower = RISK_STOPS[i];
      upper = RISK_STOPS[i + 1];
      break;
    }
  }

  const span = upper.at - lower.at;
  const t = span === 0 ? 0 : (p - lower.at) / span;
  const [r, g, b] = lower.rgb.map((channel, i) => mix(channel, upper.rgb[i], t));
  return `rgb(${r}, ${g}, ${b})`;
}
