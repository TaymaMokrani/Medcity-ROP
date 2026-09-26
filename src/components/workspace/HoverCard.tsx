import {
  QUADRANT_NAMES,
  ctiArtefact,
  ctiReliable,
  fmt,
  heatColour,
  pxAndDd,
  vesselHeat,
  type DiscScale,
  type WsSegment,
} from "@/lib/workspace";

const CARD_WIDTH = 264;
const CARD_HEIGHT = 132;
const GAP = 18;

/**
 * What one vessel measured, beside the cursor.
 *
 * It follows the mouse so the eye never leaves the vessel to read the number,
 * and flips to the other side near an edge so it never covers what it
 * describes. A tortuosity that cannot be trusted says so instead of showing a
 * number that looks trustworthy.
 */
export default function HoverCard({
  segment,
  x,
  y,
  bounds,
  scale,
}: {
  segment: WsSegment;
  x: number;
  y: number;
  bounds: { width: number; height: number };
  scale: DiscScale | null;
}) {
  const left = x + GAP + CARD_WIDTH > bounds.width ? x - GAP - CARD_WIDTH : x + GAP;
  const top = y + GAP + CARD_HEIGHT > bounds.height ? y - GAP - CARD_HEIGHT : y + GAP;

  const heat = vesselHeat(segment);
  const reliable = ctiReliable(segment);
  const quadrant = segment.location?.quadrant;
  const zone = segment.location?.zone_geom;
  const width = segment.caliber?.diameter_px;

  const place = [
    quadrant ? QUADRANT_NAMES[quadrant] : null,
    zone ? `Zone ${zone}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className="pointer-events-none absolute z-20 rounded-xl border border-line bg-bg/92 px-3.5 py-3 shadow-[0_18px_50px_-18px_rgba(0,0,0,0.9)] backdrop-blur-md"
      style={{ left, top, width: CARD_WIDTH }}
    >
      <div className="flex items-center gap-2">
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: heat === null ? "#94a3b8" : heatColour(heat) }}
        />
        <span className="text-label font-medium text-ink">Vessel #{segment.id}</span>
        {place && <span className="truncate text-micro text-ink-3">{place}</span>}
      </div>

      <dl className="mt-2.5 grid grid-cols-[5.25rem_1fr] gap-x-2 gap-y-1 text-label">
        <dt className="text-ink-3">Tortuosity</dt>
        <dd className="tabular-nums text-ink">
          {ctiArtefact(segment) ? (
            <span className="text-amber-200/90">not reliable · looped trace</span>
          ) : reliable ? (
            <>
              CTI {fmt(segment.tortuosity?.CTI, 3)}
              <span className="text-ink-3"> · curv. {fmt(segment.tortuosity?.ICLc, 3)}</span>
            </>
          ) : (
            <>
              <span className="text-ink-3">CTI n/a · </span>
              curv. {fmt(segment.tortuosity?.ICLc, 3)}
            </>
          )}
        </dd>

        <dt className="text-ink-3">Width</dt>
        <dd className="tabular-nums text-ink">
          {width ? `${width.toFixed(1)} px` : "—"}
          <span className="text-ink-3">
            {" · "}
            {segment.caliber?.source === "edt" ? "distance transform" : "cross-sections"}
          </span>
        </dd>

        <dt className="text-ink-3">Length</dt>
        <dd className="tabular-nums text-ink">
          {pxAndDd(segment.length_px ?? 0, scale)}
        </dd>
      </dl>

      {!reliable && !ctiArtefact(segment) && (
        <p className="mt-2 text-micro leading-snug text-ink-3">
          Too short or looped for arc-over-chord. Width and length still hold.
        </p>
      )}
    </div>
  );
}
