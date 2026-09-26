import { useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ImageDown,
  ImagePlus,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  Printer,
  Users2,
} from "lucide-react";
import { useAsset } from "@/lib/assets";
import { formatPma } from "@/lib/format";
import {
  DEFAULT_FILTERS,
  discScale,
  eyeLabel,
  photoCount,
  type Quadrant,
  type WsFilters,
  type WsPacket,
  type WsSegment,
  type WsSession,
} from "@/lib/workspace";
import { cn } from "@/lib/utils";
import BottomBar from "./BottomBar";
import LayersPanel from "./panels/LayersPanel";
import MeasurePanel from "./panels/MeasurePanel";
import SummaryPanel from "./panels/SummaryPanel";
import PrintReport from "./PrintReport";
import ShortcutsDialog from "./ShortcutsDialog";
import { downloadCanvas, renderSnapshot } from "./snapshot";
import {
  DEFAULT_ADJUST,
  DEFAULT_LAYERS,
  type ImageAdjust,
  type LayerKey,
  type LayerState,
  type Measurement,
  type PanelTab,
  type Tool,
  type ViewMode,
  type WorkspaceNav,
} from "./state";
import ToolRail from "./ToolRail";
import { GhostButton } from "./ui";
import Viewer, { type ViewerHandle } from "./Viewer";

type MeasureBook = Record<string, Measurement[]>;

interface History {
  past: MeasureBook[];
  present: MeasureBook;
  future: MeasureBook[];
}

const TABS: { value: PanelTab; label: string }[] = [
  { value: "layers", label: "Layers" },
  { value: "measure", label: "Measure" },
  { value: "summary", label: "Summary" },
];

const LAYER_KEYS: Record<string, LayerKey> = { "1": "vessels", "4": "disc", "5": "zones", "6": "quadrants" };

/** A key pressed while typing belongs to the field, not to the Workspace. */
function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el?.tagName) return false;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable) return true;
  if (tag === "INPUT") {
    const type = (el as HTMLInputElement).type;
    return type !== "range" && type !== "checkbox";
  }
  return false;
}

/**
 * The Vessel Workspace itself: one eye's photographs, the measurements drawn
 * over them, and the tools to take the drawing apart.
 *
 * The picture gets the room. Tools sit in a thin rail on the left, the panels
 * on the right, the photographs along the bottom — the layout of an imaging
 * viewer, because that is what a doctor reading vessels already knows.
 */
export default function Workspace({
  session,
  fetchPacket,
  stage,
  nav,
}: {
  /** What is open, or null while nothing is — the canvas then shows `stage`. */
  session: WsSession | null;
  fetchPacket?: (key: string) => Promise<WsPacket>;
  stage?: ReactNode;
  nav: WorkspaceNav;
}) {
  const eyes = useMemo(() => session?.summary.eyes ?? [], [session]);
  const viewer = useRef<ViewerHandle | null>(null);

  const [eyeSide, setEyeSide] = useState<"L" | "R">(eyes[0]?.eye ?? "L");
  const [photoByEye, setPhotoByEye] = useState<Record<string, number>>({});
  const [modeState, setMode] = useState<ViewMode>("photo");
  const [layers, setLayers] = useState<LayerState>(DEFAULT_LAYERS);
  const [filters, setFilters] = useState<WsFilters>(DEFAULT_FILTERS);
  const [adjust, setAdjust] = useState<ImageAdjust>(DEFAULT_ADJUST);
  const [toolState, setTool] = useState<Tool>("pan");
  const [hiddenToggle, setHiddenToggle] = useState(false);
  const [hiddenHold, setHiddenHold] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [history, setHistory] = useState<History>({ past: [], present: {}, future: [] });
  const [selection, setSelection] = useState<{ key: string; segment: WsSegment } | null>(null);
  const [tab, setTab] = useState<PanelTab>("layers");
  const [panelOpen, setPanelOpen] = useState(true);
  const [packets, setPackets] = useState<Record<string, WsPacket | "error">>({});
  const [shortcuts, setShortcuts] = useState(false);
  const [busy, setBusy] = useState<"export" | "print" | null>(null);
  const [toast, setToast] = useState("");
  const [printJob, setPrintJob] = useState<{ id: number; snapshot: string | null } | null>(null);

  const eye = eyes.find((e) => e.eye === eyeSide) ?? eyes[0];
  const photos = useMemo(() => eye?.evidence.photos ?? [], [eye]);
  const photoIndex = Math.min(photoByEye[eye?.eye ?? "L"] ?? 0, Math.max(0, photos.length - 1));
  const photo = photos[photoIndex];
  const packetKey = photo?.packet ?? "";
  const loaded = packets[packetKey];
  const packet = loaded && loaded !== "error" ? loaded : null;

  const single = eye ? photoCount(eye) < 2 : true;
  const available: Record<ViewMode, boolean> = {
    photo: true,
    map: !single && Boolean(eye?.evidence.map),
    front: !single && Boolean(eye?.evidence.front),
  };
  const mode: ViewMode = available[modeState] ? modeState : "photo";
  const onPhoto = mode === "photo";
  const canMeasure = onPhoto && packet?.status === "ok";
  const tool: Tool = canMeasure ? toolState : "pan";
  const overlaysHidden = hiddenToggle || hiddenHold;

  // The stored path of whatever is on the glass. It is fetched with the
  // session's token like every other photograph, and cached for the tab — so
  // switching between the photograph, the joined map and the front costs one
  // download each, not one per switch.
  const stored =
    mode === "map" && eye?.evidence.map
      ? eye.evidence.map
      : mode === "front" && eye?.evidence.front
        ? eye.evidence.front
        : photo
          ? photo.image
          : "";
  const { url: src, failed: srcFailed } = useAsset(stored);

  // Every photograph of the open eye, fetched in the background with the one on
  // screen first. A few hundred kilobytes each; flicking between them is then
  // instant, and a photograph with no disc can borrow one from its neighbours.
  const requested = useRef(new Set<string>());
  useEffect(() => {
    if (!fetchPacket) return;
    const order = [photos[photoIndex], ...photos].filter(Boolean);
    for (const item of order) {
      const key = item.packet;
      if (requested.current.has(key)) continue;
      requested.current.add(key);
      fetchPacket(key)
        .then((p) => setPackets((current) => ({ ...current, [key]: p })))
        .catch(() => setPackets((current) => ({ ...current, [key]: "error" })));
    }
  }, [photos, photoIndex, fetchPacket]);

  const scale = useMemo(
    () =>
      discScale(
        packet,
        photos
          .map((p, i) => ({ index: i, packet: packets[p.packet] }))
          .filter((p) => p.index !== photoIndex)
          .map((p) => ({ index: p.index, packet: p.packet && p.packet !== "error" ? p.packet : null })),
      ),
    [packet, packets, photos, photoIndex],
  );

  const abnormalQuadrants = useMemo(
    () =>
      Object.entries(eye?.plus?.quadrants ?? {})
        .filter(([, v]) => v?.measured && v.abnormal)
        .map(([q]) => q as Quadrant),
    [eye],
  );

  const thresholds = {
    cti: eye?.plus?.thresholds?.tortuosity_gt,
    diameter: eye?.plus?.thresholds?.diameter_p90_gt,
  };

  const measurements = useMemo(
    () => history.present[packetKey] ?? [],
    [history.present, packetKey],
  );
  const selected = selection?.key === packetKey ? selection.segment : null;

  function commit(next: MeasureBook) {
    setHistory((h) => ({ past: [...h.past.slice(-49), h.present], present: next, future: [] }));
  }
  function addMeasurement(m: Measurement) {
    commit({ ...history.present, [packetKey]: [...measurements, m] });
  }
  function deleteMeasurement(id: string) {
    commit({ ...history.present, [packetKey]: measurements.filter((m) => m.id !== id) });
  }
  function clearMeasurements() {
    commit({ ...history.present, [packetKey]: [] });
  }
  function undo() {
    setHistory((h) =>
      h.past.length
        ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] }
        : h,
    );
  }
  function redo() {
    setHistory((h) =>
      h.future.length
        ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) }
        : h,
    );
  }

  function selectSegment(segment: WsSegment | null) {
    setSelection(segment ? { key: packetKey, segment } : null);
    if (segment) setTab("measure");
  }

  function goToPhoto(index: number) {
    if (!eye || !photos.length) return;
    const next = (index + photos.length) % photos.length;
    setPhotoByEye((current) => ({ ...current, [eye.eye]: next }));
    setMode("photo");
  }

  function pickPhoto(side: "L" | "R", index: number) {
    setEyeSide(side);
    setPhotoByEye((current) => ({ ...current, [side]: index }));
    setMode("photo");
  }

  function switchEye() {
    if (eyes.length < 2) return;
    setEyeSide((side) => (side === "L" ? "R" : "L"));
  }

  function toggleLayer(key: LayerKey) {
    setLayers((l) => ({ ...l, on: { ...l.on, [key]: !l.on[key] } }));
  }

  /* -------------------------------------------------------------------------
   * Export and print
   * ---------------------------------------------------------------------- */

  const place =
    mode === "photo"
      ? `photograph ${photoIndex + 1} of ${photos.length}`
      : mode === "map"
        ? "joined map"
        : "coverage";
  const caption: [string, string] = [
    `${session?.title ?? ""} · ${eye ? eyeLabel(eye.eye) : ""} eye · ${place}`,
    `MedCity Vessel Workspace · ${new Date().toLocaleDateString()} · Provisional — ${
      session?.screened ? "decision support, not a diagnosis" : "not screened by Phase 1, measurements only"
    }`,
  ];

  function snapshot() {
    return renderSnapshot({
      src,
      packet: onPhoto ? packet : null,
      layers,
      filters,
      adjust,
      overlaysHidden,
      measurements: onPhoto ? measurements : [],
      scale,
      abnormalQuadrants,
      selectedId: selected?.id ?? null,
      caption,
    });
  }

  async function exportPng() {
    setBusy("export");
    try {
      const canvas = await snapshot();
      const side = eye ? eyeLabel(eye.eye).toLowerCase() : "eye";
      const which = mode === "photo" ? `photo-${photoIndex + 1}` : mode;
      await downloadCanvas(canvas, `vessel-workspace-${side}-${which}.png`);
    } catch {
      setToast("The picture could not be exported. Check that the gateway is running.");
    } finally {
      setBusy(null);
    }
  }

  async function printReport() {
    setBusy("print");
    let image: string | null = null;
    try {
      image = (await snapshot()).toDataURL("image/jpeg", 0.92);
    } catch {
      // the report still prints; it just has no picture
    }
    setPrintJob({ id: Date.now(), snapshot: image });
    setBusy(null);
  }

  // print once the report — and its picture — is on the page
  useEffect(() => {
    if (!printJob) return;
    let cancelled = false;
    const ready = printJob.snapshot
      ? Object.assign(new Image(), { src: printJob.snapshot }).decode().catch(() => undefined)
      : Promise.resolve();
    void ready.then(() => {
      if (!cancelled) requestAnimationFrame(() => window.print());
    });
    return () => {
      cancelled = true;
    };
  }, [printJob]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  /* -------------------------------------------------------------------------
   * Keyboard
   * ---------------------------------------------------------------------- */

  // Read the current state when a key is pressed; subscribe only once.
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (nav.paused) return;
    if (!session && event.key !== "?") return;
    if (event.key === "Escape") {
      viewer.current?.cancelDraft();
      setSelection(null);
      setShortcuts(false);
      return;
    }
    if (typing(event.target)) return;
    const mod = event.ctrlKey || event.metaKey;

    if (mod && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && event.key.toLowerCase() === "y") {
      event.preventDefault();
      redo();
      return;
    }
    if (mod || event.altKey) return;

    if (event.key === " ") {
      event.preventDefault();
      setSpaceHeld(true);
      return;
    }

    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    switch (key) {
      case "v":
        setTool("pan");
        break;
      case "m":
        if (canMeasure) setTool("ruler");
        break;
      case "a":
        if (canMeasure) setTool("angle");
        break;
      case "h":
        if (!event.repeat) setHiddenHold(true);
        break;
      case "f":
        viewer.current?.fit();
        break;
      case "0":
        viewer.current?.actualSize();
        break;
      case "+":
      case "=":
        viewer.current?.zoomBy(1.3);
        break;
      case "-":
      case "_":
        viewer.current?.zoomBy(1 / 1.3);
        break;
      case "[":
        goToPhoto(photoIndex - 1);
        break;
      case "]":
        goToPhoto(photoIndex + 1);
        break;
      case "e":
        switchEye();
        break;
      case "r":
        setAdjust((x) => ({ ...x, redFree: !x.redFree }));
        break;
      case "i":
        setAdjust((x) => ({ ...x, invert: !x.invert }));
        break;
      case "2":
        setLayers((l) => ({ ...l, colour: !l.colour }));
        break;
      case "3":
        setLayers((l) => ({ ...l, caliber: !l.caliber }));
        break;
      case "?":
        setShortcuts((open) => !open);
        break;
      default:
        if (LAYER_KEYS[key]) toggleLayer(LAYER_KEYS[key]);
    }
  });

  useEffect(() => {
    const down = (event: KeyboardEvent) => onKeyDown(event);
    const up = (event: KeyboardEvent) => {
      if (event.key === " ") setSpaceHeld(false);
      if (event.key.toLowerCase() === "h") setHiddenHold(false);
    };
    const blur = () => {
      setSpaceHeld(false);
      setHiddenHold(false);
    };

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  const open = Boolean(session && eye);

  return (
    <>
      <div
        className="app-scope theme-dark fixed inset-0 flex flex-col bg-bg font-body text-ink print:hidden"
        style={{ colorScheme: "dark" }}
      >
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-3">
          <button
            onClick={nav.onBack}
            title={nav.backLabel}
            aria-label={nav.backLabel}
            className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-ink-3 transition-colors hover:bg-white/[0.06] hover:text-ink"
          >
            <ArrowLeft className="size-4" />
          </button>
          <h1 className="font-heading text-xl text-ink">Vessel Workspace</h1>

          {/*
            Whose eyes these are, for a saved examination only.
            An import is deliberately anonymous — it carries no patient and
            printing a name over one would invent a link that does not exist.
            A saved examination is the opposite case: it is filed in someone's
            notes, and the screen it was read on should say whose.
          */}
          {session?.record && (
            <p className="flex min-w-0 items-baseline gap-2 border-l border-line pl-3">
              <span className="truncate text-body text-ink">{session.title}</span>
              <span className="shrink-0 text-micro text-ink-3 tabular-nums">
                {session.record.patientId}
                {session.record.dateOfBirth &&
                  session.record.gestationalAge != null &&
                  ` · PMA ${formatPma(session.record.dateOfBirth, session.record.gestationalAge)}`}
              </span>
            </p>
          )}

          {session && !session.record && (
            <p className="text-micro text-ink-3">
              Imported photographs · not a patient record
            </p>
          )}

          <div className="ml-auto flex items-center gap-2">
            {open && (
              <>
                <GhostButton icon={busy === "export" ? Loader2 : ImageDown} onClick={exportPng} disabled={!!busy}>
                  Export PNG
                </GhostButton>
                <GhostButton icon={busy === "print" ? Loader2 : Printer} onClick={printReport} disabled={!!busy}>
                  Print report
                </GhostButton>
                <span className="mx-1 h-5 w-px bg-line" />
                <GhostButton icon={Users2} onClick={nav.onOpenPatient}>
                  Open patient
                </GhostButton>
                <GhostButton icon={ImagePlus} onClick={nav.onImportImages}>
                  Import images
                </GhostButton>
              </>
            )}
            <button
              onClick={() => setPanelOpen((isOpen) => !isOpen)}
              aria-label={panelOpen ? "Hide the side panel" : "Show the side panel"}
              title={panelOpen ? "Hide the side panel" : "Show the side panel"}
              className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-ink-3 hover:bg-white/[0.06] hover:text-ink"
            >
              {panelOpen ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
            </button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          {/* the picture, its tools and its photographs; the side panel runs the full height beside them */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1">
              <ToolRail
                disabled={!open}
                tool={tool}
                onTool={setTool}
                canMeasure={canMeasure}
                overlaysHidden={overlaysHidden}
                onToggleOverlays={() => setHiddenToggle((h) => !h)}
                onZoomIn={() => viewer.current?.zoomBy(1.3)}
                onZoomOut={() => viewer.current?.zoomBy(1 / 1.3)}
                onFit={() => viewer.current?.fit()}
                onActualSize={() => viewer.current?.actualSize()}
                onShortcuts={() => setShortcuts(true)}
              />
    
              <main className="relative min-w-0 flex-1">
                {!open || !eye ? (
                  stage
                ) : src ? (
                  <Viewer
                    ref={viewer}
                    src={src}
                    alt={`${eyeLabel(eye.eye)} eye, ${place}`}
                    packet={onPhoto ? packet : null}
                    packetLoading={onPhoto && !loaded}
                    layers={layers}
                    filters={filters}
                    adjust={adjust}
                    overlaysHidden={overlaysHidden}
                    tool={tool}
                    spaceHeld={spaceHeld}
                    measurements={onPhoto ? measurements : []}
                    onMeasure={addMeasurement}
                    selectedId={selected?.id ?? null}
                    onSelect={selectSegment}
                    scale={scale}
                    abnormalQuadrants={abnormalQuadrants}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center px-6 text-center text-body text-ink-3">
                    {/* Three different things, and they must not be confused.
                        "Nothing was measured" is a finding; "still loading"
                        and "the file would not come" are not. */}
                    {!stored
                      ? "No photograph was measured for this eye."
                      : srcFailed
                        ? "This picture could not be loaded. Its file is missing from the server — run the vessel analysis again to redraw it."
                        : "Loading…"}
                  </div>
                )}
    
                {open && tool !== "pan" && (
                  <div className="pointer-events-none absolute right-3 top-3 z-10 rounded-md bg-bg/80 px-2.5 py-1 text-micro text-ink/80 backdrop-blur">
                    {tool === "ruler"
                      ? "Drag across the photograph to measure"
                      : "Click one end, the vertex, then the other end"}
                    <span className="text-ink-3"> · Esc to cancel · V to stop</span>
                  </div>
                )}
    
                {open && mode === "front" && (
                  <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md bg-bg/80 px-3 py-1.5 text-micro text-ink-3 backdrop-blur">
                    <span className="flex items-center gap-1.5">
                      <span className="h-0.5 w-4 rounded bg-emerald-400" /> front verified
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-0.5 w-4 rounded bg-amber-400" /> vessels ran off the photograph
                    </span>
                    <span>dimmed: never photographed</span>
                  </div>
                )}
                {open && mode === "map" && (
                  <div className="pointer-events-none absolute left-3 top-3 z-10 max-w-md rounded-md bg-bg/80 px-3 py-1.5 text-micro leading-snug text-ink-3 backdrop-blur">
                    Every photograph aligned into one frame, each tinted differently. For looking
                    only — measure on the photographs.
                  </div>
                )}
              </main>
            </div>

            <BottomBar
              eyes={open ? eyes : []}
              activeEye={eye?.eye ?? null}
              photoByEye={photoByEye}
              onPhoto={pickPhoto}
              mode={mode}
              onMode={setMode}
              available={available}
              single={single}
              packets={packets}
              onImportMore={nav.onImportImages}
            />
          </div>

          {panelOpen && (
            <aside className="flex w-[340px] shrink-0 flex-col border-l border-line bg-panel/60">
              <div className="flex shrink-0 gap-5 border-b border-line px-4">
                {TABS.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => setTab(t.value)}
                    disabled={!open}
                    className={cn(
                      "-mb-px cursor-pointer border-b-2 py-2.5 text-label font-medium transition-colors disabled:cursor-default",
                      open && tab === t.value
                        ? "border-accent text-ink"
                        : "border-transparent text-ink-3 hover:text-ink disabled:hover:text-ink-3",
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {!open || !eye || !session ? (
                  <p className="p-4 text-label leading-relaxed text-ink-3">
                    Open a patient or import images to see the layers, the measurements and
                    the summary here.
                  </p>
                ) : (
                  <>
                    {tab === "layers" && (
                      <LayersPanel
                        layers={layers}
                        onLayers={setLayers}
                        filters={filters}
                        onFilters={setFilters}
                        adjust={adjust}
                        onAdjust={setAdjust}
                        hasDisc={Boolean(packet?.optic_disc?.found)}
                        hasOverlays={onPhoto}
                      />
                    )}
                    {tab === "measure" && (
                      <MeasurePanel
                        packet={packet}
                        filters={filters}
                        selected={selected}
                        onSelect={selectSegment}
                        onFlyTo={(segment) => viewer.current?.flyTo(segment)}
                        measurements={measurements}
                        onDeleteMeasurement={deleteMeasurement}
                        onClearMeasurements={clearMeasurements}
                        canUndo={history.past.length > 0}
                        canRedo={history.future.length > 0}
                        onUndo={undo}
                        onRedo={redo}
                        scale={scale}
                        thresholds={thresholds}
                        isPhoto={onPhoto}
                      />
                    )}
                    {tab === "summary" && (
                      <SummaryPanel
                        eye={eye}
                        summary={session.summary}
                        screened={session.screened}
                        title={session.title}
                        subtitle={session.subtitle}
                      />
                    )}
                  </>
                )}
              </div>
            </aside>
          )}
        </div>


        {toast && (
          <div className="fixed bottom-24 left-1/2 z-40 -translate-x-1/2 rounded-lg border border-rose-400/30 bg-panel px-4 py-2 text-label text-rose-200 shadow-2xl">
            {toast}
          </div>
        )}
        {shortcuts && <ShortcutsDialog onClose={() => setShortcuts(false)} />}
      </div>

      {printJob && session && (
        <PrintReport
          session={session}
          snapshot={printJob.snapshot}
          snapshotCaption={caption.join(" — ")}
          measurements={onPhoto ? measurements : []}
          scale={scale}
        />
      )}

      {/* the red-free view: the green channel, in grey */}
      <svg aria-hidden className="pointer-events-none absolute size-0">
        <filter id="ws-red-free" colorInterpolationFilters="sRGB">
          <feColorMatrix
            type="matrix"
            values="0 1 0 0 0  0 1 0 0 0  0 1 0 0 0  0 0 0 1 0"
          />
        </filter>
      </svg>
    </>
  );
}
