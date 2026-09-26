import { RotateCcw } from "lucide-react";
import {
  DEFAULT_FILTERS,
  QUADRANTS,
  QUADRANT_NAMES,
  RED_BAND,
  heatColour,
  type Quadrant,
  type WsFilters,
} from "@/lib/workspace";
import { cn } from "@/lib/utils";
import {
  DEFAULT_ADJUST,
  type ImageAdjust,
  type LayerKey,
  type LayerState,
} from "../state";
import { Note, Section, Segmented, Slider, Switch } from "../ui";

const OVERLAYS: { key: LayerKey; label: string; hint: string; shortcut: string; needsDisc?: boolean }[] = [
  { key: "vessels", label: "Vessels", hint: "Every traced centreline", shortcut: "1" },
  { key: "disc", label: "Optic disc", hint: "Outline and centre", shortcut: "4", needsDisc: true },
  {
    key: "zones",
    label: "Zone rings",
    hint: "Approximate ICROP I and II, from disc size",
    shortcut: "5",
    needsDisc: true,
  },
  { key: "quadrants", label: "Quadrants", hint: "ST · IT · SN · IN through the disc", shortcut: "6", needsDisc: true },
];

export default function LayersPanel({
  layers,
  onLayers,
  filters,
  onFilters,
  adjust,
  onAdjust,
  hasDisc,
  hasOverlays,
}: {
  layers: LayerState;
  onLayers: (next: LayerState) => void;
  filters: WsFilters;
  onFilters: (next: WsFilters) => void;
  adjust: ImageAdjust;
  onAdjust: (next: ImageAdjust) => void;
  hasDisc: boolean;
  /** False on the joined map and coverage pictures, which carry no layers. */
  hasOverlays: boolean;
}) {
  const setOn = (key: LayerKey, on: boolean) =>
    onLayers({ ...layers, on: { ...layers.on, [key]: on } });
  const setOpacity = (key: LayerKey, value: number) =>
    onLayers({ ...layers, opacity: { ...layers.opacity, [key]: value } });

  return (
    <div>
      <Section title="Overlays">
        {!hasOverlays && (
          <div className="mb-3">
            <Note>
              This picture is a rendered map. Widths and twistiness were measured on
              the original photographs, so nothing here is drawn as a layer.
            </Note>
          </div>
        )}
        <div className={cn("space-y-3", !hasOverlays && "pointer-events-none opacity-35")}>
          {OVERLAYS.map((row) => {
            const disabled = Boolean(row.needsDisc && !hasDisc);
            return (
              <div key={row.key}>
                <div className="flex items-center gap-3">
                  <Switch
                    label={row.label}
                    checked={layers.on[row.key] && !disabled}
                    disabled={disabled}
                    onChange={(on) => setOn(row.key, on)}
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        "text-label",
                        disabled ? "text-white/30" : "text-ink/90",
                      )}
                      title={
                        disabled
                          ? "No optic disc in this photograph, so there is nothing to anchor this to"
                          : row.hint
                      }
                    >
                      {row.label}
                    </p>
                  </div>
                  <div className="w-20">
                    <Slider
                      compact
                      label={`${row.label} opacity`}
                      value={Math.round(layers.opacity[row.key] * 100)}
                      min={10}
                      max={100}
                      step={5}
                      disabled={disabled || !layers.on[row.key]}
                      onChange={(v) => setOpacity(row.key, v / 100)}
                    />
                  </div>
                </div>

                {row.key === "vessels" && (
                  <div className="ml-10 mt-2 space-y-2">
                    <label className="flex items-center gap-2.5 text-label text-ink/75">
                      <Switch
                        label="Colour by tortuosity"
                        checked={layers.colour}
                        disabled={!layers.on.vessels}
                        onChange={(colour) => onLayers({ ...layers, colour })}
                      />
                      Colour by tortuosity
                    </label>
                    <label className="flex items-center gap-2.5 text-label text-ink/75">
                      <Switch
                        label="Draw at measured width"
                        checked={layers.caliber}
                        disabled={!layers.on.vessels}
                        onChange={(caliber) => onLayers({ ...layers, caliber })}
                      />
                      Draw at measured width
                    </label>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      <Section
        title="Filters"
        action={
          <button
            onClick={() => onFilters(DEFAULT_FILTERS)}
            className="cursor-pointer text-micro text-ink-3 hover:text-ink"
          >
            Reset
          </button>
        }
      >
        <div className={cn("space-y-4", !hasOverlays && "pointer-events-none opacity-35")}>
          <Slider
            label="Most twisted only"
            value={Math.round(filters.minHeat * 100)}
            display={filters.minHeat === 0 ? "all vessels" : `top of scale from ${Math.round(filters.minHeat * 100)}%`}
            min={0}
            max={95}
            step={5}
            onChange={(v) => onFilters({ ...filters, minHeat: v / 100 })}
          />
          <Slider
            label="Minimum length"
            value={filters.minLength}
            display={`${filters.minLength} px`}
            min={0}
            max={200}
            step={5}
            onChange={(v) => onFilters({ ...filters, minLength: v })}
          />
          <div>
            <p className="mb-1.5 text-label text-ink/85">Quadrant</p>
            <Segmented<"all" | Quadrant>
              size="sm"
              value={filters.quadrant ?? "all"}
              onChange={(q) => onFilters({ ...filters, quadrant: q === "all" ? null : q })}
              options={[
                { value: "all", label: "All" },
                ...QUADRANTS.map((q) => ({
                  value: q,
                  label: q,
                  disabled: !hasDisc,
                  title: QUADRANT_NAMES[q],
                })),
              ]}
            />
          </div>
        </div>
      </Section>

      <Section title="Legend">
        <HeatLegend />
        <ul className="mt-3 space-y-1.5 text-micro leading-snug text-ink-3">
          <li className="flex items-center gap-2">
            <span className="h-0.5 w-5 rounded bg-slate-400/70" />
            Drawn plain: a looped trace whose tortuosity is arithmetic, not disease
          </li>
          <li className="flex items-center gap-2">
            <span className="h-0.5 w-5 rounded bg-sky-300/45" />
            Fainter: width from distance transform, weaker evidence
          </li>
          <li className="flex items-center gap-2">
            <span className="h-0 w-5 border-t border-dashed border-violet-400" />
            Zone rings are approximate — derived from disc size
          </li>
        </ul>
      </Section>

      <Section
        title="Image"
        action={
          <button
            onClick={() => onAdjust(DEFAULT_ADJUST)}
            className="inline-flex cursor-pointer items-center gap-1 text-micro text-ink-3 hover:text-ink"
          >
            <RotateCcw className="size-3" /> Reset
          </button>
        }
      >
        <div className="space-y-4">
          <Slider
            label="Brightness"
            value={Math.round(adjust.brightness * 100)}
            display={`${Math.round(adjust.brightness * 100)}%`}
            min={40}
            max={220}
            step={5}
            onChange={(v) => onAdjust({ ...adjust, brightness: v / 100 })}
          />
          <Slider
            label="Contrast"
            value={Math.round(adjust.contrast * 100)}
            display={`${Math.round(adjust.contrast * 100)}%`}
            min={40}
            max={220}
            step={5}
            onChange={(v) => onAdjust({ ...adjust, contrast: v / 100 })}
          />
          <label className="flex items-center justify-between gap-3 text-label text-ink/85">
            <span>
              Red-free
              <span className="block text-micro text-ink-3">
                Green channel only — vessels stand out
              </span>
            </span>
            <Switch
              label="Red-free"
              checked={adjust.redFree}
              onChange={(redFree) => onAdjust({ ...adjust, redFree })}
            />
          </label>
          <label className="flex items-center justify-between gap-3 text-label text-ink/85">
            Invert
            <Switch
              label="Invert"
              checked={adjust.invert}
              onChange={(invert) => onAdjust({ ...adjust, invert })}
            />
          </label>
        </div>
      </Section>
    </div>
  );
}

function HeatLegend() {
  const steps = 40;
  return (
    <div>
      <p className="mb-5 text-label text-ink/85">Tortuosity</p>
      <div className="relative">
        <span
          className="absolute -top-[18px] -translate-x-1/2 whitespace-nowrap text-micro text-white/70"
          style={{ left: `${RED_BAND * 100}%` }}
        >
          red band
        </span>
        <div className="flex h-1.5 overflow-hidden rounded-full">
          {Array.from({ length: steps }, (_, i) => (
            <span
              key={i}
              className="flex-1"
              style={{ backgroundColor: heatColour(i / (steps - 1)) }}
            />
          ))}
        </div>
        <span
          className="absolute -top-1 h-3.5 w-px bg-white/70"
          style={{ left: `${RED_BAND * 100}%` }}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-micro text-ink-3">
        <span>straight</span>
        <span>twisted</span>
      </div>
      <p className="mt-2 text-micro leading-snug text-ink-3">
        Coloured by the hotter of arc-over-chord (CTI) and curvature (ICLc). The red
        band starts at CTI 1.105 or ICLc 0.052. Red marks vessels to look at — the
        grade comes from the plus score.
      </p>
    </div>
  );
}
