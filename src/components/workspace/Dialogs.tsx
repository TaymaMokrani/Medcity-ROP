import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronRight, ImagePlus, Loader2, Search, X } from "lucide-react";
import { errorMessage } from "@/lib/api";
import { getDetections, type Detection } from "@/lib/detections";
import { formatDate } from "@/lib/format";
import { getPatients, type Patient } from "@/lib/patients";
import type { Phase2Status } from "@/lib/severity";
import { WORKSPACE_MAX_PHOTOS, startWorkspaceAnalysis } from "@/lib/workspace";
import { cn } from "@/lib/utils";
import { pillClass } from "./Stage";
import { Segmented } from "./ui";

type Side = "Left" | "Right";
type Picked = { id: string; file: File; preview: string };

/** The detection list carries the Phase 2 status; the shared type does not name it. */
type ListedDetection = Detection & { phase2Status?: Phase2Status };

const STATUS: Record<Phase2Status, { label: string; className: string }> = {
  done: { label: "Measured", className: "border-accent/35 text-accent" },
  running: { label: "Measuring", className: "border-white/15 text-ink/70" },
  queued: { label: "Queued", className: "border-white/15 text-ink/70" },
  failed: { label: "Failed", className: "border-rose-400/35 text-rose-200/90" },
  none: { label: "Not measured", className: "border-white/10 text-ink-3" },
};

function Dialog({
  title,
  subtitle,
  onClose,
  children,
  width = "max-w-xl",
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="app-scope theme-dark fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 font-body backdrop-blur-sm"
      style={{ colorScheme: "dark" }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label={title}
        className={cn(
          "flex max-h-[86vh] w-full flex-col rounded-2xl border border-line bg-panel p-5 text-ink shadow-2xl",
          width,
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="font-heading text-xl">{title}</h2>
            <p className="mt-0.5 text-label text-ink-3">{subtitle}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer rounded-md p-1 text-ink-3 hover:bg-white/[0.06] hover:text-ink"
          >
            <X className="size-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * Open an existing patient: their saved examinations, grouped under their name.
 * Measured ones open at once; the others can be measured in the Workspace.
 */
export function OpenPatientDialog({
  onClose,
  onOpen,
}: {
  onClose: () => void;
  onOpen: (detectionId: string) => void;
}) {
  const [detections, setDetections] = useState<ListedDetection[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    getDetections()
      .then((list) => setDetections(list as ListedDetection[]))
      .catch((e) => setError(errorMessage(e, "Could not load the examinations.")));
  }, []);

  const patients = useMemo(() => {
    const q = query.trim().toLowerCase();
    const groups = new Map<string, { name: string; id: string; items: ListedDetection[] }>();
    for (const d of detections ?? []) {
      if (q && !d.patientName.toLowerCase().includes(q) && !d.patientId.toLowerCase().includes(q)) {
        continue;
      }
      const group = groups.get(d.patientId) ?? { name: d.patientName, id: d.patientId, items: [] };
      group.items.push(d);
      groups.set(d.patientId, group);
    }
    const byDate = (a: ListedDetection, b: ListedDetection) =>
      (b.date || b.createdAt).localeCompare(a.date || a.createdAt);
    return [...groups.values()]
      .map((g) => ({ ...g, items: g.items.sort(byDate) }))
      .sort((a, b) => byDate(a.items[0], b.items[0]));
  }, [detections, query]);

  return (
    <Dialog
      title="Open existing patient"
      subtitle="Choose one of the patient's examinations."
      onClose={onClose}
    >
      <label className="flex h-9 shrink-0 items-center gap-2 rounded-lg border border-line bg-white/[0.03] px-3 focus-within:border-accent/40">
        <Search className="size-3.5 text-ink-3" />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by patient name or ID"
          className="w-full bg-transparent text-body text-ink placeholder:text-ink-3/70 focus:outline-none"
        />
      </label>

      <div className="-mx-2 mt-3 min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <p className="px-2 py-6 text-label text-rose-200/90">{error}</p>
        ) : !detections ? (
          <p className="flex items-center gap-2 px-2 py-6 text-label text-ink-3">
            <Loader2 className="size-3.5 animate-spin" /> Loading patients…
          </p>
        ) : patients.length === 0 ? (
          <p className="px-2 py-6 text-label text-ink-3">
            {detections.length ? "No patient matches that search." : "No examinations saved yet."}
          </p>
        ) : (
          patients.map((patient) => (
            <section key={patient.id} className="mb-2">
              <p className="px-2 pb-1 pt-2 text-micro font-medium uppercase tracking-[0.18em] text-ink-3">
                {patient.name}
              </p>
              <ul>
                {patient.items.map((d) => {
                  const status = STATUS[d.phase2Status ?? "none"] ?? STATUS.none;
                  return (
                    <li key={d.id}>
                      <button
                        onClick={() => onOpen(d.id)}
                        className="group flex w-full cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-white/[0.04]"
                      >
                        <span className="min-w-0 flex-1 truncate text-body text-ink">
                          {formatDate(d.date)}
                          <span className="text-ink-3">
                            {" · "}
                            {d.eye === "Both" ? "Both eyes" : `${d.eye} eye`}
                          </span>
                        </span>
                        <span
                          className={cn(
                            "shrink-0 rounded-full border px-2 py-0.5 text-micro font-medium",
                            status.className,
                          )}
                        >
                          {status.label}
                        </span>
                        <ChevronRight className="size-4 shrink-0 text-white/20 transition-colors group-hover:text-ink" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>
    </Dialog>
  );
}

/** Import images: measure vessels on photographs without screening them. Nothing is saved. */
export function ImportImagesDialog({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (jobId: string, patientId: string | null) => void;
}) {
  const [side, setSide] = useState<Side | "Both">("Left");
  const [images, setImages] = useState<Record<Side, Picked[]>>({ Left: [], Right: [] });
  const [patients, setPatients] = useState<Patient[]>([]);
  const [patientId, setPatientId] = useState("");
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);

  const urls = useRef<string[]>([]);
  useEffect(() => {
    const created = urls.current;
    return () => created.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    getPatients()
      .then(setPatients)
      .catch(() => setPatients([]));
  }, []);

  const active: Side[] = side === "Both" ? ["Left", "Right"] : [side];
  const counts = active.map((s) => images[s].length);
  const ready = counts.every((n) => n >= 1 && n <= WORKSPACE_MAX_PHOTOS);
  const anySingle = counts.some((n) => n === 1);

  function add(eye: Side, list: FileList | File[]) {
    const files = Array.from(list).filter((f) => f.type.startsWith("image/"));
    const room = WORKSPACE_MAX_PHOTOS - images[eye].length;
    const accepted = files.slice(0, Math.max(0, room)).map((file, i) => {
      const preview = URL.createObjectURL(file);
      urls.current.push(preview);
      return { id: `${Date.now()}-${i}-${file.name}`, file, preview };
    });
    setError(
      files.length > accepted.length
        ? `At most ${WORKSPACE_MAX_PHOTOS} photographs per eye — ${files.length - accepted.length} left out.`
        : "",
    );
    setImages((current) => ({ ...current, [eye]: [...current[eye], ...accepted] }));
  }

  function remove(eye: Side, id: string) {
    setImages((current) => ({ ...current, [eye]: current[eye].filter((p) => p.id !== id) }));
  }

  async function start() {
    setStarting(true);
    setError("");
    try {
      const { jobId } = await startWorkspaceAnalysis({
        left: active.includes("Left") ? images.Left.map((p) => p.file) : [],
        right: active.includes("Right") ? images.Right.map((p) => p.file) : [],
      });
      onImported(jobId, patientId || null);
    } catch (e) {
      setError(errorMessage(e, "The analysis could not be started."));
      setStarting(false);
    }
  }

  return (
    <Dialog
      title="Import images"
      subtitle="1 to 5 photographs per eye. They are measured, not screened, and not saved."
      onClose={onClose}
      width="max-w-2xl"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented<Side | "Both">
          value={side}
          onChange={setSide}
          options={[
            { value: "Left", label: "Left eye" },
            { value: "Right", label: "Right eye" },
            { value: "Both", label: "Both" },
          ]}
        />
        <select
          value={patientId}
          onChange={(event) => setPatientId(event.target.value)}
          className="h-8 max-w-[14rem] cursor-pointer rounded-lg border border-line bg-bg px-2 text-label text-ink focus:border-accent/40 focus:outline-none"
        >
          <option value="">No patient — anonymous</option>
          {patients.map((p) => (
            <option key={p.id} value={p.id}>
              {p.firstName} {p.lastName}
            </option>
          ))}
        </select>
      </div>

      <div className={cn("mt-4 grid gap-3", active.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
        {active.map((eye) => (
          <DropZone
            key={eye}
            eye={eye}
            images={images[eye]}
            onAdd={(files) => add(eye, files)}
            onRemove={(id) => remove(eye, id)}
          />
        ))}
      </div>

      <p className="mt-4 text-micro leading-relaxed text-ink-3">
        For the joined map and the zone, take 2–5 shots of an eye: spread them out, push to
        the periphery, and centre one on the optic disc.
      </p>
      {anySingle && (
        <p className="mt-2 border-l-2 border-amber-400/60 pl-3 text-micro leading-relaxed text-amber-100/85">
          One photograph: the vessels are measured, but the joined map, coverage and zone need
          two or more.
        </p>
      )}
      {error && <p className="mt-2 text-label text-rose-200/90">{error}</p>}

      <div className="mt-5 flex items-center justify-end">
        <button
          onClick={() => void start()}
          disabled={!ready || starting}
          title={ready ? undefined : "Add at least one photograph for each chosen eye"}
          className={pillClass}
        >
          {starting && <Loader2 className="size-4 animate-spin" />}
          Measure vessels
        </button>
      </div>
    </Dialog>
  );
}

function DropZone({
  eye,
  images,
  onAdd,
  onRemove,
}: {
  eye: Side;
  images: Picked[];
  onAdd: (files: FileList) => void;
  onRemove: (id: string) => void;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  const [over, setOver] = useState(false);
  const full = images.length >= WORKSPACE_MAX_PHOTOS;

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        if (!full) onAdd(event.dataTransfer.files);
      }}
      className={cn(
        "rounded-xl border border-dashed p-3 transition-colors",
        over ? "border-accent/60 bg-accent/[0.06]" : "border-white/15 bg-white/[0.015]",
      )}
    >
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-label text-ink/90">{eye} eye</span>
        <span className="text-micro tabular-nums text-ink-3">
          {images.length} / {WORKSPACE_MAX_PHOTOS}
        </span>
      </div>

      <div className="grid grid-cols-5 gap-1.5">
        {images.map((p, i) => (
          <div key={p.id} className="group relative aspect-[4/3] overflow-hidden rounded-md bg-black">
            <img src={p.preview} alt={`${eye} eye photograph ${i + 1}`} className="size-full object-cover" />
            <button
              onClick={() => onRemove(p.id)}
              aria-label="Remove photograph"
              className="absolute right-0.5 top-0.5 flex size-4 cursor-pointer items-center justify-center rounded bg-black/70 text-white opacity-0 transition-opacity group-hover:opacity-100"
            >
              <X className="size-3" />
            </button>
          </div>
        ))}
        {!full && (
          <button
            onClick={() => input.current?.click()}
            className="flex aspect-[4/3] cursor-pointer flex-col items-center justify-center gap-0.5 rounded-md border border-white/10 text-ink-3 transition-colors hover:border-accent/40 hover:text-ink"
          >
            <ImagePlus className="size-4" strokeWidth={1.6} />
            <span className="text-micro">Add</span>
          </button>
        )}
      </div>
      {images.length === 0 && (
        <p className="mt-2 text-micro text-ink-3">Drop photographs here, or click Add.</p>
      )}
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          if (event.target.files) onAdd(event.target.files);
          event.target.value = "";
        }}
      />
    </div>
  );
}
