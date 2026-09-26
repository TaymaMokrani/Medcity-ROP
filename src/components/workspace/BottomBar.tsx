import { ImagePlus, Lock } from "lucide-react";
import AuthImage from "@/components/app/AuthImage";
import { eyeLabel, type WsEye, type WsPacket } from "@/lib/workspace";
import { cn } from "@/lib/utils";
import type { ViewMode } from "./state";

const MODES: { value: ViewMode; label: string }[] = [
  { value: "photo", label: "Photographs" },
  { value: "map", label: "Joined map" },
  { value: "front", label: "Coverage" },
];

/**
 * Which picture is on the canvas: the three views side by side, then every
 * photograph grouped under its eye. Picking a photograph of the other eye
 * switches eye — there is no separate switch to find.
 *
 * The joined map and coverage need two or more photographs of the eye; with
 * one, they stay visible but locked, and the bar says what would unlock them.
 */
export default function BottomBar({
  eyes,
  activeEye,
  photoByEye,
  onPhoto,
  mode,
  onMode,
  available,
  single,
  packets,
  onImportMore,
}: {
  eyes: WsEye[];
  activeEye: "L" | "R" | null;
  photoByEye: Record<string, number>;
  onPhoto: (eye: "L" | "R", index: number) => void;
  mode: ViewMode;
  onMode: (mode: ViewMode) => void;
  available: Record<ViewMode, boolean>;
  single: boolean;
  packets: Record<string, WsPacket | "error">;
  onImportMore: () => void;
}) {
  const open = eyes.length > 0;

  return (
    <footer className="flex h-[78px] shrink-0 items-center gap-5 border-t border-line bg-bg px-4">
      <div className="inline-flex shrink-0 rounded-lg border border-line bg-white/[0.02] p-0.5">
        {MODES.map((option) => {
          const locked = !open || (option.value !== "photo" && !available[option.value]);
          return (
            <button
              key={option.value}
              disabled={locked}
              onClick={() => onMode(option.value)}
              title={
                locked && open
                  ? single
                    ? "Needs 2–5 photographs of this eye"
                    : "Not produced for this eye"
                  : undefined
              }
              className={cn(
                "inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-label font-medium transition-colors disabled:cursor-not-allowed",
                open && mode === option.value
                  ? "bg-white/[0.09] text-ink"
                  : locked
                    ? "text-white/25"
                    : "text-ink-3 hover:text-ink",
              )}
            >
              {option.label}
              {locked && open && single && <Lock className="size-3" strokeWidth={2} />}
            </button>
          );
        })}
      </div>

      {open && <span className="h-11 w-px shrink-0 bg-line" />}

      <div className="flex min-w-0 items-center gap-6 overflow-x-auto">
        {eyes.map((eye) => {
          const isActive = eye.eye === activeEye;
          const photos = eye.evidence.photos ?? [];
          return (
            <div key={eye.eye} className="flex shrink-0 flex-col gap-1.5">
              <button
                onClick={() => onPhoto(eye.eye, photoByEye[eye.eye] ?? 0)}
                className={cn(
                  "cursor-pointer text-left text-micro font-medium uppercase tracking-[0.18em] transition-colors",
                  isActive ? "text-ink" : "text-ink-3 hover:text-ink",
                )}
              >
                {eyeLabel(eye.eye)} eye
              </button>
              <div className="flex gap-1.5">
                {photos.map((photo, i) => {
                  const packet = packets[photo.packet];
                  const bad = packet === "error" || (packet && packet.status !== "ok");
                  const selected = isActive && mode === "photo" && (photoByEye[eye.eye] ?? 0) === i;
                  return (
                    <button
                      key={photo.packet}
                      onClick={() => onPhoto(eye.eye, i)}
                      aria-label={`${eyeLabel(eye.eye)} eye, photograph ${i + 1}`}
                      title={bad ? "Could not be measured" : `${eyeLabel(eye.eye)} eye · photograph ${i + 1}`}
                      className={cn(
                        "relative h-[38px] w-[52px] shrink-0 cursor-pointer overflow-hidden rounded-md border transition-all",
                        selected
                          ? "border-accent ring-1 ring-accent/40"
                          : isActive
                            ? "border-line opacity-70 hover:opacity-100"
                            : "border-line opacity-35 hover:opacity-80",
                      )}
                    >
                      {/* a missing file leaves a dark tile, not a broken-image icon */}
                      <AuthImage
                        src={photo.image}
                        alt=""
                        className="size-full object-cover"
                        frameClassName="size-full opacity-40"
                      />
                      <span className="absolute bottom-0 left-1 text-micro font-medium text-white drop-shadow">
                        {i + 1}
                      </span>
                      {bad && (
                        <span className="absolute right-1 top-1 size-1.5 rounded-full bg-amber-400" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {open && single && (
        <div className="ml-auto flex shrink-0 items-center gap-3 rounded-lg border border-amber-400/25 bg-amber-400/[0.06] px-3 py-2">
          <p className="max-w-[20rem] text-micro leading-snug text-amber-100/85">
            Upload other angle shots (2–5) of this eye to unlock the joined map, coverage and
            zone assessment.
          </p>
          <button
            onClick={onImportMore}
            className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-amber-300/30 px-2.5 py-1 text-micro text-amber-100 hover:bg-amber-300/10"
          >
            <ImagePlus className="size-3.5" strokeWidth={1.8} /> Import
          </button>
        </div>
      )}
    </footer>
  );
}
