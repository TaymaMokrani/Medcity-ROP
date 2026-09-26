import { useCallback, useEffect, useRef, useState } from "react";
import {
    ChevronLeft,
    ChevronRight,
    Contrast,
    Maximize2,
    Sun,
    X,
    ZoomIn,
    ZoomOut,
} from "lucide-react";
import type { DetectionImage } from "@/lib/detections";
import { useAsset } from "@/lib/assets";
import { IconButton } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * The photograph, at the size of the screen.
 *
 * A retinal photograph was previously readable only at about 300 px wide, in a
 * side column, with no zoom — and the full viewer refused to open a screening
 * that had not been through the severity analysis. So the plain photographs get
 * their own viewer here: zoom, pan, brightness and contrast, and nothing else,
 * because anything measured belongs in the Workspace where the measurements
 * are.
 *
 * Brightness and contrast are display only. They change what is on the glass,
 * never the file, and the panel says so.
 */
export default function Lightbox({
    images,
    index,
    onIndex,
    onClose,
    caption,
}: {
    images: DetectionImage[];
    index: number;
    onIndex: (index: number) => void;
    onClose: () => void;
    caption?: string;
}) {
    // Pan and zoom belong to one photograph. Holding the index alongside them
    // means a new photograph starts fitted, without an effect that resets it
    // one render late — and without ever showing the old corner of a new eye.
    const FITTED = { zoom: 1, x: 0, y: 0 };
    const [view, setView] = useState({ key: index, ...FITTED });
    const current = view.key === index ? view : { key: index, ...FITTED };
    const { zoom } = current;
    const offset = { x: current.x, y: current.y };

    const [brightness, setBrightness] = useState(100);
    const [contrast, setContrast] = useState(100);
    const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

    const image = images[index];
    // Fetched with the session's token, like every other photograph. The
    // neighbours are not prefetched: paging is a deliberate act and one
    // request per photograph is cheap next to a lightbox that opens holding
    // five.
    const photo = useAsset(image?.url);
    const reset = useCallback(() => setView({ key: index, ...FITTED }), [index]);
    const setZoom = useCallback(
        (next: (z: number) => number) =>
            setView((v) => {
                const from = v.key === index ? v : { key: index, ...FITTED };
                return { ...from, key: index, zoom: Math.min(8, Math.max(1, next(from.zoom))) };
            }),
        [index],
    );
    const setOffset = useCallback(
        (next: { x: number; y: number }) =>
            setView((v) => ({ ...(v.key === index ? v : { key: index, ...FITTED }), key: index, ...next })),
        [index],
    );

    const step = useCallback(
        (by: number) => {
            if (images.length < 2) return;
            onIndex((index + by + images.length) % images.length);
        },
        [images.length, index, onIndex],
    );

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose();
            if (event.key === "ArrowRight") step(1);
            if (event.key === "ArrowLeft") step(-1);
            if (event.key === "0") reset();
            if (event.key === "+" || event.key === "=") setZoom((z) => z * 1.3);
            if (event.key === "-") setZoom((z) => z / 1.3);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose, step, reset]);

    if (!image) return null;

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label="Retinal photograph"
            className="theme-dark fixed inset-0 z-50 flex flex-col bg-[#05070c]/95 backdrop-blur-sm"
        >
            <header className="flex shrink-0 items-center gap-3 border-b border-line px-3 py-2">
                <p className="min-w-0 flex-1 truncate text-label text-ink-2">
                    {caption ? `${caption} · ` : ""}
                    {image.eye} eye · photograph {index + 1} of {images.length}
                </p>

                <div className="flex items-center gap-1">
                    <IconButton
                        icon={ZoomOut}
                        label="Zoom out"
                        onClick={() => setZoom((z) => z / 1.3)}
                    />
                    <span className="w-12 text-center text-micro text-ink-3 tabular-nums">
                        {Math.round(zoom * 100)}%
                    </span>
                    <IconButton
                        icon={ZoomIn}
                        label="Zoom in"
                        onClick={() => setZoom((z) => z * 1.3)}
                    />
                    <IconButton icon={Maximize2} label="Fit to screen" onClick={reset} />
                    <span className="mx-1 h-5 w-px bg-line" />
                    <IconButton icon={X} label="Close" onClick={onClose} />
                </div>
            </header>

            <div
                className="relative min-h-0 flex-1 overflow-hidden"
                onPointerDown={(event) => {
                    drag.current = {
                        x: event.clientX,
                        y: event.clientY,
                        ox: offset.x,
                        oy: offset.y,
                    };
                    event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                    const from = drag.current;
                    if (!from) return;
                    setOffset({
                        x: from.ox + (event.clientX - from.x),
                        y: from.oy + (event.clientY - from.y),
                    });
                }}
                onPointerUp={() => (drag.current = null)}
                onWheel={(event) => {
                    const next = event.deltaY < 0 ? 1.12 : 1 / 1.12;
                    setZoom((z) => z * next);
                }}
                style={{ cursor: zoom > 1 ? "grab" : "default" }}
            >
                {photo.url ? (
                    <img
                        src={photo.url}
                        alt={`${image.eye} eye, photograph ${index + 1}`}
                        draggable={false}
                        className="absolute left-1/2 top-1/2 max-h-full max-w-full select-none"
                        style={{
                            transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
                            filter: `brightness(${brightness}%) contrast(${contrast}%)`,
                        }}
                    />
                ) : (
                    <p className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-body text-white/70">
                        {photo.failed
                            ? "This photograph could not be loaded."
                            : "Loading…"}
                    </p>
                )}

                {images.length > 1 && (
                    <>
                        <Arrow side="left" onClick={() => step(-1)} />
                        <Arrow side="right" onClick={() => step(1)} />
                    </>
                )}
            </div>

            <footer className="flex shrink-0 flex-wrap items-center gap-x-8 gap-y-3 border-t border-line px-4 py-3">
                <Adjust
                    icon={Sun}
                    label="Brightness"
                    value={brightness}
                    onChange={setBrightness}
                />
                <Adjust
                    icon={Contrast}
                    label="Contrast"
                    value={contrast}
                    onChange={setContrast}
                />
                <p className="ml-auto text-micro text-ink-3">
                    Display only — the photograph on file is unchanged.
                </p>
            </footer>
        </div>
    );
}

function Arrow({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
    const Icon = side === "left" ? ChevronLeft : ChevronRight;
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={side === "left" ? "Previous photograph" : "Next photograph"}
            className={cn(
                "absolute top-1/2 flex size-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-line bg-[#05070c]/70 text-ink-2 transition-colors hover:text-ink",
                side === "left" ? "left-3" : "right-3",
            )}
        >
            <Icon className="size-5" aria-hidden />
        </button>
    );
}

function Adjust({
    icon: Icon,
    label,
    value,
    onChange,
}: {
    icon: typeof Sun;
    label: string;
    value: number;
    onChange: (value: number) => void;
}) {
    return (
        <label className="flex items-center gap-2.5">
            <Icon className="size-4 shrink-0 text-ink-3" aria-hidden />
            <span className="text-label text-ink-2">{label}</span>
            <input
                type="range"
                min={40}
                max={200}
                step={5}
                value={value}
                aria-label={label}
                onChange={(event) => onChange(Number(event.target.value))}
                className="rop-slider w-40"
                style={{ "--rop-slider-fill": `${((value - 40) / 160) * 100}%` } as React.CSSProperties}
            />
            <span className="w-10 text-right text-micro text-ink-3 tabular-nums">
                {value}%
            </span>
        </label>
    );
}
