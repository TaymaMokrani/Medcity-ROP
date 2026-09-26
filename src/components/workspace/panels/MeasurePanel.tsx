import { useMemo, useState } from "react";
import { Crosshair, Redo2, Ruler, Trash2, TriangleRight, Undo2, X } from "lucide-react";
import {
  QUADRANTS,
  QUADRANT_NAMES,
  ctiArtefact,
  ctiReliable,
  fmt,
  heatColour,
  passesFilters,
  pxAndDd,
  vesselHeat,
  type DiscScale,
  type WsFilters,
  type WsPacket,
  type WsSegment,
} from "@/lib/workspace";
import { cn } from "@/lib/utils";
import { angleAt, distance, measurementName, type Measurement } from "../state";
import { Kbd, Note, Section, Stat } from "../ui";

type SortKey = "heat" | "cti" | "width" | "length";

const PAGE = 40;
/** Fewer reliable vessels than this and a quadrant's p90 is a guess. */
const THIN_QUADRANT = 5;

export default function MeasurePanel({
  packet,
  filters,
  selected,
  onSelect,
  onFlyTo,
  measurements,
  onDeleteMeasurement,
  onClearMeasurements,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  scale,
  thresholds,
  isPhoto,
}: {
  packet: WsPacket | null;
  filters: WsFilters;
  selected: WsSegment | null;
  onSelect: (segment: WsSegment | null) => void;
  onFlyTo: (segment: WsSegment) => void;
  measurements: Measurement[];
  onDeleteMeasurement: (id: string) => void;
  onClearMeasurements: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  scale: DiscScale | null;
  thresholds: { cti?: number; diameter?: number };
  isPhoto: boolean;
}) {
  if (!isPhoto) {
    return (
      <div className="p-4">
        <Note>
          Measuring works on the original photographs only. The joined map is warped
          to line the photographs up, so a distance read off it would be wrong. Go
          back to Photographs to measure.
        </Note>
      </div>
    );
  }

  return (
    <div>
      <Section
        title="Pinned vessel"
        action={
          selected && (
            <button
              onClick={() => onSelect(null)}
              className="inline-flex cursor-pointer items-center gap-1 text-micro text-ink-3 hover:text-ink"
            >
              <X className="size-3" /> Clear
            </button>
          )
        }
      >
        {selected ? (
          <VesselDetail segment={selected} scale={scale} onFlyTo={() => onFlyTo(selected)} />
        ) : (
          <p className="text-label leading-relaxed text-ink-3">
            Hover a vessel to read it. Click to pin it here.
          </p>
        )}
      </Section>

      <Section
        title="Your measurements"
        action={
          <div className="flex items-center gap-1">
            <IconMini label="Undo (Ctrl+Z)" disabled={!canUndo} onClick={onUndo} icon={Undo2} />
            <IconMini label="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={onRedo} icon={Redo2} />
            <IconMini
              label="Delete all on this photograph"
              disabled={!measurements.length}
              onClick={onClearMeasurements}
              icon={Trash2}
            />
          </div>
        }
      >
        {measurements.length ? (
          <ul className="space-y-1">
            {measurements.map((m, i) => (
              <li
                key={m.id}
                className="group flex items-center gap-2.5 rounded-md px-1.5 py-1 text-label hover:bg-white/[0.04]"
              >
                {m.kind === "ruler" ? (
                  <Ruler className="size-3.5 shrink-0 text-accent" strokeWidth={1.7} />
                ) : (
                  <TriangleRight className="size-3.5 shrink-0 text-accent" strokeWidth={1.7} />
                )}
                <span className="text-ink-3">{measurementName(measurements, i)}</span>
                <span className="ml-auto tabular-nums text-ink">
                  {m.kind === "ruler"
                    ? pxAndDd(distance(m.a, m.b), scale)
                    : `${angleAt(m.a, m.b, m.c).toFixed(1)}°`}
                </span>
                <button
                  onClick={() => onDeleteMeasurement(m.id)}
                  aria-label="Delete measurement"
                  className="cursor-pointer text-white/25 opacity-0 transition-opacity hover:text-rose-300 group-hover:opacity-100"
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-label leading-relaxed text-ink-3">
            <Kbd>M</Kbd> ruler: drag across the photograph. <Kbd>A</Kbd> angle: click
            one end, the vertex, then the other end.
          </p>
        )}
        <p className="mt-2.5 text-micro leading-snug text-ink-3">
          {scale
            ? scale.borrowedFrom === null
              ? `1 DD = ${scale.ddPx.toFixed(0)} px, from the disc in this photograph.`
              : `1 DD = ${scale.ddPx.toFixed(0)} px, borrowed from the disc in photograph ${
                  scale.borrowedFrom + 1
                } — same camera, same eye.`
            : "No optic disc was found in these photographs, so distances are in pixels only."}
        </p>
      </Section>

      {packet?.status === "ok" && (
        <>
          <VesselTable
            packet={packet}
            filters={filters}
            selectedId={selected?.id ?? null}
            onPick={(segment) => {
              onSelect(segment);
              onFlyTo(segment);
            }}
          />
          <QuadrantTable packet={packet} thresholds={thresholds} />
        </>
      )}
    </div>
  );
}

function IconMini({
  icon: Icon,
  label,
  disabled,
  onClick,
}: {
  icon: typeof Undo2;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="flex size-6 cursor-pointer items-center justify-center rounded-md text-ink-3 hover:bg-white/[0.06] hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
    >
      <Icon className="size-3.5" strokeWidth={1.8} />
    </button>
  );
}

function VesselDetail({
  segment,
  scale,
  onFlyTo,
}: {
  segment: WsSegment;
  scale: DiscScale | null;
  onFlyTo: () => void;
}) {
  const heat = vesselHeat(segment);
  const reliable = ctiReliable(segment);
  const quadrant = segment.location?.quadrant;
  const d = segment.caliber?.diameter_px;
  const p90 = segment.caliber?.diameter_p90_px;
  const toDisc = segment.location?.dist_to_od_px;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-body text-ink">
          <span
            className="size-2 rounded-full"
            style={{ backgroundColor: heat === null ? "#94a3b8" : heatColour(heat) }}
          />
          Vessel #{segment.id}
        </span>
        <button
          onClick={onFlyTo}
          className="inline-flex cursor-pointer items-center gap-1 text-micro text-accent/90 hover:text-accent"
        >
          <Crosshair className="size-3" /> Zoom to it
        </button>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Stat
          label="Tortuosity (CTI)"
          value={reliable ? fmt(segment.tortuosity?.CTI, 3) : "not reliable"}
          muted={!reliable}
          hint={
            ctiArtefact(segment)
              ? "Looped trace — the chord collapses"
              : !reliable
                ? "Too short or looped"
                : "1.000 is perfectly straight"
          }
        />
        <Stat label="Curvature (ICLc)" value={fmt(segment.tortuosity?.ICLc, 4)} />
        <Stat
          label="Width (median)"
          value={d ? pxAndDd(d, scale, 1) : "—"}
          hint={segment.caliber?.source === "edt" ? "Distance transform — weaker" : `${segment.caliber?.n_cross_sections ?? 0} cross-sections`}
        />
        <Stat label="Width (p90)" value={p90 ? `${p90.toFixed(1)} px` : "—"} />
        <Stat label="Length" value={pxAndDd(segment.length_px ?? 0, scale)} />
        <Stat label="From the disc" value={toDisc != null ? pxAndDd(toDisc, scale) : "—"} />
        <Stat label="Quadrant" value={quadrant ? QUADRANT_NAMES[quadrant] : "—"} />
        <Stat
          label="Zone (geometric)"
          value={segment.location?.zone_geom ? `Zone ${segment.location.zone_geom}` : "—"}
          hint="From approximate rings"
        />
      </dl>
      {(segment.n_parts ?? 1) > 1 && (
        <p className="mt-3 text-micro text-ink-3">
          Joined from {segment.n_parts} traced pieces across branch points.
        </p>
      )}
    </div>
  );
}

function VesselTable({
  packet,
  filters,
  selectedId,
  onPick,
}: {
  packet: WsPacket;
  filters: WsFilters;
  selectedId: number | null;
  onPick: (segment: WsSegment) => void;
}) {
  const [sort, setSort] = useState<SortKey>("heat");
  const [all, setAll] = useState(false);

  const rows = useMemo(() => {
    const visible = packet.segments.filter((s) => passesFilters(s, filters));
    const value = (s: WsSegment): number => {
      switch (sort) {
        case "heat":
          return vesselHeat(s) ?? -1;
        case "cti":
          return ctiReliable(s) ? (s.tortuosity?.CTI ?? 0) : -1;
        case "width":
          return s.caliber?.diameter_px ?? 0;
        case "length":
          return s.length_px ?? 0;
      }
    };
    return visible.sort((a, b) => value(b) - value(a));
  }, [packet, filters, sort]);

  const shown = all ? rows : rows.slice(0, PAGE);

  const header = (key: SortKey, label: string, className = "") => (
    <th className={cn("py-1.5 font-normal", className)}>
      <button
        onClick={() => setSort(key)}
        className={cn(
          "cursor-pointer uppercase tracking-[0.12em] transition-colors",
          sort === key ? "text-ink" : "hover:text-ink",
        )}
      >
        {label}
        {sort === key && " ↓"}
      </button>
    </th>
  );

  return (
    <Section title={`Vessels shown · ${rows.length}`}>
      <div className="-mx-1 max-h-72 overflow-y-auto">
        <table className="w-full text-left text-label tabular-nums">
          <thead className="sticky top-0 bg-panel text-micro text-ink-3">
            <tr>
              <th className="py-1.5 pl-1 font-normal">#</th>
              {header("heat", "Heat")}
              {header("cti", "CTI")}
              {header("width", "Width")}
              {header("length", "Len.", "pr-1 text-right")}
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => {
              const heat = vesselHeat(s);
              return (
                <tr
                  key={s.id}
                  onClick={() => onPick(s)}
                  className={cn(
                    "cursor-pointer border-t border-white/[0.04] transition-colors hover:bg-white/[0.05]",
                    s.id === selectedId && "bg-accent/10",
                  )}
                >
                  <td className="py-1 pl-1 text-ink-3">{s.id}</td>
                  <td className="py-1">
                    <span
                      className="inline-block h-1.5 w-8 rounded-full"
                      style={{ backgroundColor: heat === null ? "#64748b" : heatColour(heat) }}
                    />
                  </td>
                  <td className={cn("py-1", ctiReliable(s) ? "text-ink" : "text-white/25")}>
                    {ctiReliable(s) ? fmt(s.tortuosity?.CTI, 3) : "—"}
                  </td>
                  <td className="py-1 text-ink">{fmt(s.caliber?.diameter_px, 1)}</td>
                  <td className="py-1 pr-1 text-right text-ink">{Math.round(s.length_px ?? 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > PAGE && (
        <button
          onClick={() => setAll(!all)}
          className="mt-2 cursor-pointer text-micro text-ink-3 hover:text-ink"
        >
          {all ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      )}
      <p className="mt-2 text-micro leading-snug text-ink-3">
        Click a row to find the vessel. Width and length in pixels. “—” means the CTI of
        that vessel cannot be trusted.
      </p>
    </Section>
  );
}

function QuadrantTable({
  packet,
  thresholds,
}: {
  packet: WsPacket;
  thresholds: { cti?: number; diameter?: number };
}) {
  const stats = packet.quadrants?.stats;
  if (!packet.optic_disc?.found || !stats) {
    return (
      <Section title="Quadrants · this photograph">
        <p className="text-label text-ink-3">
          No optic disc here, so the retina cannot be split into quadrants.
        </p>
      </Section>
    );
  }

  return (
    <Section title="Quadrants · this photograph">
      <table className="w-full text-left text-label tabular-nums">
        <thead className="text-micro uppercase tracking-[0.12em] text-ink-3">
          <tr>
            <th className="py-1 font-normal" />
            <th className="py-1 font-normal">CTI p90</th>
            <th className="py-1 font-normal">Width p90</th>
            <th className="py-1 text-right font-normal">Backed by</th>
          </tr>
        </thead>
        <tbody>
          {QUADRANTS.map((q) => {
            const row = stats[q];
            const n = row?.n_cti_reliable ?? 0;
            const thin = n < THIN_QUADRANT;
            const ctiHigh = thresholds.cti != null && (row?.cti_p90 ?? 0) > thresholds.cti;
            const widthHigh =
              thresholds.diameter != null && (row?.diameter_p90 ?? 0) > thresholds.diameter;
            return (
              <tr key={q} className={cn("border-t border-white/[0.04]", thin && "opacity-45")}>
                <td className="py-1.5 text-ink-3" title={QUADRANT_NAMES[q]}>
                  {q}
                </td>
                <td className={cn("py-1.5", ctiHigh ? "text-rose-300" : "text-ink")}>
                  {n ? fmt(row?.cti_p90, 3) : "—"}
                </td>
                <td className={cn("py-1.5", widthHigh ? "text-rose-300" : "text-ink")}>
                  {row?.n_segments ? `${fmt(row?.diameter_p90, 1)} px` : "—"}
                </td>
                <td className="py-1.5 text-right text-ink-3">{n} vessels</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-micro leading-snug text-ink-3">
        Rose: above the rule in force (CTI &gt; {fmt(thresholds.cti, 4)}, width &gt;{" "}
        {fmt(thresholds.diameter, 2)} px). Faded: fewer than {THIN_QUADRANT} reliable
        vessels. The eye-level count is in Summary.
      </p>
    </Section>
  );
}
