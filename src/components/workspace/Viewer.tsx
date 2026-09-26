import {
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type Ref,
} from "react";
import { Loader2 } from "lucide-react";
import {
  passesFilters,
  type DiscScale,
  type Quadrant,
  type WsFilters,
  type WsPacket,
  type WsSegment,
} from "@/lib/workspace";
import { drawOverlay, segmentBox, vesselAt } from "./draw";
import HoverCard from "./HoverCard";
import Minimap from "./Minimap";
import {
  distance,
  imageFilter,
  measurementId,
  type Draft,
  type ImageAdjust,
  type LayerState,
  type Measurement,
  type Point,
  type Tool,
  type View,
} from "./state";

export interface ViewerHandle {
  fit(): void;
  zoomBy(factor: number): void;
  actualSize(): void;
  flyTo(segment: WsSegment): void;
  cancelDraft(): void;
}

interface ViewerProps {
  ref?: Ref<ViewerHandle>;
  src: string;
  alt: string;
  /** The measurements for this photograph, or null for a picture with none. */
  packet: WsPacket | null;
  packetLoading: boolean;
  layers: LayerState;
  filters: WsFilters;
  adjust: ImageAdjust;
  overlaysHidden: boolean;
  tool: Tool;
  spaceHeld: boolean;
  measurements: Measurement[];
  onMeasure: (measurement: Measurement) => void;
  selectedId: number | null;
  onSelect: (segment: WsSegment | null) => void;
  scale: DiscScale | null;
  abnormalQuadrants: Quadrant[];
}

const HIT_TOLERANCE_PX = 9;
const FIT_MARGIN = 0.94;

function fitFor(stage: { w: number; h: number }, world: { w: number; h: number }): View {
  const k = Math.min(stage.w / world.w, stage.h / world.h) * FIT_MARGIN;
  return { k, tx: (stage.w - world.w * k) / 2, ty: (stage.h - world.h * k) / 2 };
}

/**
 * The picture, with everything measured on it drawn over the top.
 *
 * World coordinates here are the displayed image's own pixels. The packet was
 * measured on the original photograph, which is larger, so overlays and the
 * doctor's measurements carry one extra uniform factor, `s`. Measurements are
 * stored in original pixels, so a ruler reads in the same pixels the vessel
 * widths were measured in.
 */
export default function Viewer({
  ref,
  src,
  alt,
  packet,
  packetLoading,
  layers,
  filters,
  adjust,
  overlaysHidden,
  tool,
  spaceHeld,
  measurements,
  onMeasure,
  selectedId,
  onSelect,
  scale,
  abnormalQuadrants,
}: ViewerProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [natural, setNatural] = useState<{ src: string; w: number; h: number } | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [userView, setUserView] = useState<{ key: string; view: View } | null>(null);
  const [hover, setHover] = useState<{ segment: WsSegment; x: number; y: number } | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [draftState, setDraftState] = useState<{ key: string; draft: Draft } | null>(null);
  const [dragging, setDragging] = useState(false);

  const world = natural && natural.src === src ? { w: natural.w, h: natural.h } : null;
  const key = world ? `${src}|${world.w}x${world.h}` : "";
  const fitView = world && stage.w > 0 ? fitFor(stage, world) : null;
  const view = userView && userView.key === key ? userView.view : fitView;

  // original-photograph pixels per displayed pixel, inverted
  const s = packet && world ? world.w / packet.image.width : 1;
  const measuring = tool !== "pan" && !spaceHeld && Boolean(packet);
  const draftKey = `${key}|${tool}`;
  const draft = draftState && draftState.key === draftKey ? draftState.draft : null;

  // Everything the non-React listeners need, read at the moment they fire.
  const latest = useRef({ view, fitView, key, world, s, packet, filters, layers, overlaysHidden });
  useLayoutEffect(() => {
    latest.current = { view, fitView, key, world, s, packet, filters, layers, overlaysHidden };
  });

  function setView(next: View) {
    if (latest.current.key) setUserView({ key: latest.current.key, view: next });
  }

  function zoomAround(factor: number, sx: number, sy: number) {
    const current = latest.current.view;
    const fit = latest.current.fitView;
    if (!current || !fit) return;
    const k = Math.min(fit.k * 24, Math.max(fit.k * 0.5, current.k * factor));
    const applied = k / current.k;
    setUserView({
      key: latest.current.key,
      view: { k, tx: sx - (sx - current.tx) * applied, ty: sy - (sy - current.ty) * applied },
    });
  }

  function centreOn(x: number, y: number, k?: number) {
    const current = latest.current.view;
    if (!current) return;
    const zoom = k ?? current.k;
    setUserView({
      key: latest.current.key,
      view: { k: zoom, tx: stage.w / 2 - x * zoom, ty: stage.h / 2 - y * zoom },
    });
  }

  useImperativeHandle(ref, () => ({
    fit() {
      setUserView(null);
    },
    zoomBy(factor: number) {
      zoomAround(factor, stage.w / 2, stage.h / 2);
    },
    actualSize() {
      const current = latest.current.view;
      if (!current) return;
      const k = 1 / latest.current.s;
      const cx = (stage.w / 2 - current.tx) / current.k;
      const cy = (stage.h / 2 - current.ty) / current.k;
      centreOn(cx, cy, k);
    },
    flyTo(segment: WsSegment) {
      const fit = latest.current.fitView;
      if (!fit) return;
      const f = latest.current.s;
      const [x0, y0, x1, y1] = segmentBox(segment);
      const w = Math.max(40, (x1 - x0) * f);
      const h = Math.max(40, (y1 - y0) * f);
      const k = Math.min(fit.k * 10, Math.max(fit.k * 1.5, Math.min(stage.w / w, stage.h / h) * 0.45));
      centreOn(((x0 + x1) / 2) * f, ((y0 + y1) / 2) * f, k);
    },
    cancelDraft() {
      setDraftState(null);
    },
  }));

  // the stage follows whatever room the layout gives it
  useEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setStage({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Wheel zoom has to be a non-passive listener, or the page scrolls with it.
  const onWheel = useEffectEvent((event: WheelEvent) => {
    const element = stageRef.current;
    if (!element) return;
    event.preventDefault();
    const bounds = element.getBoundingClientRect();
    const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0018));
    zoomAround(factor, event.clientX - bounds.left, event.clientY - bounds.top);
  });
  useEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const listener = (event: WheelEvent) => onWheel(event);
    element.addEventListener("wheel", listener, { passive: false });
    return () => element.removeEventListener("wheel", listener);
  }, []);

  // Redraw whenever anything that changes the picture changes.
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const hoveredId = hover?.segment.id ?? null;
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const width = Math.round(stage.w * dpr);
    const height = Math.round(stage.h * dpr);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    if (!view) return;
    const overlayView = { k: view.k * s, tx: view.tx, ty: view.ty };
    if (!packet) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    drawOverlay(ctx, {
      packet,
      view: overlayView,
      dpr,
      width: stage.w,
      height: stage.h,
      layers,
      filters,
      hoveredId,
      selectedId,
      abnormalQuadrants,
      measurements,
      draft,
      scale,
      hidden: overlaysHidden,
    });
  }, [
    stage,
    dpr,
    view,
    s,
    packet,
    layers,
    filters,
    hoveredId,
    selectedId,
    abnormalQuadrants,
    measurements,
    draft,
    scale,
    overlaysHidden,
  ]);

  /* -------------------------------------------------------------------------
   * Pointer
   * ---------------------------------------------------------------------- */

  const drag = useRef<{ x: number; y: number; view: View; moved: boolean; pan: boolean } | null>(
    null,
  );
  const hoverFrame = useRef<number | null>(null);
  const pendingPoint = useRef<{ sx: number; sy: number } | null>(null);

  /** Screen position inside the stage → original-photograph pixels. */
  function toOriginal(sx: number, sy: number): Point | null {
    const current = latest.current.view;
    if (!current) return null;
    const f = latest.current.s;
    return [(sx - current.tx) / current.k / f, (sy - current.ty) / current.k / f];
  }

  function local(event: React.PointerEvent): { sx: number; sy: number } {
    const bounds = stageRef.current!.getBoundingClientRect();
    return { sx: event.clientX - bounds.left, sy: event.clientY - bounds.top };
  }

  function scheduleHover(point: { sx: number; sy: number } | null) {
    pendingPoint.current = point;
    if (hoverFrame.current != null) return;
    hoverFrame.current = requestAnimationFrame(() => {
      hoverFrame.current = null;
      const p = pendingPoint.current;
      const state = latest.current;
      if (!p) {
        setHover(null);
        setCursor(null);
        return;
      }
      const at = toOriginal(p.sx, p.sy);
      setCursor(at);
      if (
        !at ||
        !state.packet ||
        state.packet.status !== "ok" ||
        state.overlaysHidden ||
        !state.layers.on.vessels ||
        drag.current?.moved
      ) {
        setHover(null);
        return;
      }
      const tolerance = HIT_TOLERANCE_PX / ((state.view?.k ?? 1) * state.s);
      const found = vesselAt(state.packet, state.filters, at[0], at[1], tolerance);
      setHover(found ? { segment: found, x: p.sx, y: p.sy } : null);
    });
  }

  useEffect(
    () => () => {
      if (hoverFrame.current != null) cancelAnimationFrame(hoverFrame.current);
    },
    [],
  );

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!view || event.button === 2) return;
    const { sx, sy } = local(event);
    const pan = !measuring || event.button === 1;

    if (pan) {
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { x: sx, y: sy, view, moved: false, pan: true };
      setDragging(true);
      return;
    }

    const at = toOriginal(sx, sy);
    if (!at) return;
    if (tool === "ruler") {
      event.currentTarget.setPointerCapture(event.pointerId);
      setDraftState({ key: draftKey, draft: { kind: "ruler", a: at, b: at } });
      drag.current = { x: sx, y: sy, view, moved: false, pan: false };
    } else if (tool === "angle") {
      const placed = draft?.kind === "angle" ? draft.points : [];
      const points = [...placed, at];
      if (points.length === 3) {
        onMeasure({ id: measurementId(), kind: "angle", a: points[0], b: points[1], c: points[2] });
        setDraftState(null);
      } else {
        setDraftState({ key: draftKey, draft: { kind: "angle", points, cursor: at } });
      }
    }
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const { sx, sy } = local(event);
    const current = drag.current;

    if (current?.pan) {
      const dx = sx - current.x;
      const dy = sy - current.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) current.moved = true;
      if (current.moved) {
        setView({ k: current.view.k, tx: current.view.tx + dx, ty: current.view.ty + dy });
      }
    } else if (draft?.kind === "ruler" && current) {
      const at = toOriginal(sx, sy);
      if (at) setDraftState({ key: draftKey, draft: { kind: "ruler", a: draft.a, b: at } });
    } else if (draft?.kind === "angle") {
      const at = toOriginal(sx, sy);
      if (at) setDraftState({ key: draftKey, draft: { ...draft, cursor: at } });
    }
    scheduleHover({ sx, sy });
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    drag.current = null;
    setDragging(false);
    if (!current) return;

    if (current.pan && !current.moved && event.button === 0 && packet && !overlaysHidden) {
      const { sx, sy } = local(event);
      const at = toOriginal(sx, sy);
      if (at && latest.current.view) {
        const tolerance = HIT_TOLERANCE_PX / (latest.current.view.k * s);
        onSelect(vesselAt(packet, filters, at[0], at[1], tolerance));
      }
    }

    if (!current.pan && draft?.kind === "ruler") {
      // on screen, a line shorter than a few pixels was a slip, not a measurement
      const long = distance(draft.a, draft.b) * (view?.k ?? 1) * s > 4;
      if (long) onMeasure({ id: measurementId(), kind: "ruler", a: draft.a, b: draft.b });
      setDraftState(null);
    }
  }

  const shown = packet ? packet.segments.filter((seg) => passesFilters(seg, filters)).length : 0;
  const zoomedIn = view && fitView ? view.k > fitView.k * 1.2 : false;
  const filter = imageFilter(adjust);

  const disc = packet?.optic_disc;
  const notice =
    packet && packet.status !== "ok"
      ? `This photograph could not be measured${
          packet.quality?.reasons?.length
            ? ` — ${packet.quality.reasons.join(", ").replaceAll("_", " ")}`
            : ""
        }.`
      : packet && !disc?.found
        ? "No optic disc in this photograph — zone rings and quadrants are unavailable."
        : null;

  let cursorStyle = "grab";
  if (measuring) cursorStyle = "crosshair";
  else if (dragging) cursorStyle = "grabbing";
  else if (hover) cursorStyle = "pointer";

  return (
    <div
      ref={stageRef}
      className="relative size-full touch-none select-none overflow-hidden bg-[#020305]"
      style={{ cursor: cursorStyle }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => scheduleHover(null)}
      onDoubleClick={() => {
        if (!measuring) setUserView(null);
      }}
    >
      <img
        key={src}
        src={src}
        alt={alt}
        draggable={false}
        onLoad={(event) =>
          setNatural({
            src,
            w: event.currentTarget.naturalWidth,
            h: event.currentTarget.naturalHeight,
          })
        }
        onError={() => setFailedSrc(src)}
        className="pointer-events-none absolute left-0 top-0 max-w-none origin-top-left"
        style={
          world && view
            ? {
                width: world.w,
                height: world.h,
                transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.k})`,
                filter,
                imageRendering: view.k > 2.5 ? "pixelated" : "auto",
              }
            : { visibility: "hidden" }
        }
      />
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0"
        style={{ width: stage.w, height: stage.h }}
      />

      {!world && (
        <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-ink-3">
          {failedSrc === src ? (
            <p className="max-w-sm text-body leading-relaxed">
              This picture could not be loaded. Its file is missing from the server — run the
              vessel analysis again to redraw it.
            </p>
          ) : (
            <Loader2 className="size-5 animate-spin" />
          )}
        </div>
      )}

      {(packetLoading || notice) && (
        <div className="pointer-events-none absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-line bg-bg/85 px-3 py-1 text-label text-ink/85 backdrop-blur">
          {packetLoading ? (
            <>
              <Loader2 className="size-3 animate-spin" /> Loading measurements…
            </>
          ) : (
            notice
          )}
        </div>
      )}

      {hover && !dragging && !measuring && (
        <HoverCard
          segment={hover.segment}
          x={hover.x}
          y={hover.y}
          bounds={{ width: stage.w, height: stage.h }}
          scale={scale}
        />
      )}

      <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex items-center gap-3 rounded-md bg-bg/75 px-2.5 py-1 text-micro tabular-nums text-ink-3 backdrop-blur">
        {view && <span>{Math.round(view.k * s * 100)}%</span>}
        {cursor && (
          <span>
            x {Math.round(cursor[0])} · y {Math.round(cursor[1])} px
          </span>
        )}
        {packet?.status === "ok" && (
          <span>
            {shown} of {packet.segment_count} vessels
          </span>
        )}
        {overlaysHidden && <span className="text-amber-200/90">overlays hidden</span>}
      </div>

      {zoomedIn && world && view && (
        <Minimap
          src={src}
          filter={filter}
          world={world}
          view={view}
          stage={stage}
          onCentre={(x, y) => centreOn(x, y)}
        />
      )}
    </div>
  );
}
