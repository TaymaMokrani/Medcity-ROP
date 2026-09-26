/**
 * The wait while the model reads a set of photographs.
 *
 * A schematic retina with a beam going round it, and one dot per photograph
 * under it. It stands in for a few seconds of work, so it says what is being
 * waited on rather than only that something is: a pulsing camera icon could
 * have meant the page had stopped.
 *
 * Nothing here is measured — the model reports no progress during a Phase 1
 * read, so the beam is not pretending to track anything. The dots count the
 * photographs that went in, which is a fact.
 *
 * The animation stops entirely under `prefers-reduced-motion`.
 */
export default function ScanningRetina({ count }: { count: number }) {
  return (
    <div className="flex flex-col items-center">
      <svg
        viewBox="0 0 160 160"
        className="size-40"
        role="img"
        aria-label="Reading the photographs"
      >
        <defs>
          <linearGradient id="rop-scan-beam" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--app-accent)" stopOpacity="0" />
            <stop offset="100%" stopColor="var(--app-accent)" stopOpacity="0.35" />
          </linearGradient>
        </defs>

        {/* The beam, under the rings so the rings stay readable through it. */}
        <g className="rop-scan-sweep">
          <path
            d="M80,80 L80,8 A72,72 0 0,1 130.9,29.1 Z"
            fill="url(#rop-scan-beam)"
          />
          <line
            x1="80"
            y1="80"
            x2="80"
            y2="8"
            stroke="var(--app-accent)"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </g>

        <circle
          cx="80"
          cy="80"
          r="72"
          fill="none"
          stroke="var(--app-line)"
          strokeWidth="1"
        />
        <circle
          className="rop-scan-ring"
          cx="80"
          cy="80"
          r="54"
          fill="none"
          stroke="var(--app-accent)"
          strokeWidth="1"
          strokeDasharray="3 5"
        />
        <circle
          className="rop-scan-ring"
          style={{ animationDelay: "-1.2s" }}
          cx="80"
          cy="80"
          r="34"
          fill="none"
          stroke="var(--app-accent)"
          strokeWidth="1"
          strokeDasharray="3 5"
        />

        {/* The optic disc, which every reading is measured out from. */}
        <circle
          cx="80"
          cy="80"
          r="8"
          fill="var(--app-inset)"
          stroke="var(--app-ink-3)"
          strokeWidth="1.5"
        />
      </svg>

      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {Array.from({ length: count }, (_, i) => (
          <span
            key={i}
            className="rop-scan-dot size-1.5 rounded-full bg-accent"
            style={{ animationDelay: `${i * 0.12}s` }}
            aria-hidden
          />
        ))}
      </div>
    </div>
  );
}
