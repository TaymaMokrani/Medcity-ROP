import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { Plus, Upload, X } from "lucide-react";
import { REQUIRED_IMAGES_PER_EYE, type Eye } from "@/lib/detections";
import { EYE_ABBREVIATION } from "@/lib/eyes";
import { cn } from "@/lib/utils";

export interface PickedImage {
  id: string;
  file: File;
  preview: string;
}

/**
 * The photographs for one eye.
 *
 * Two changes worth naming. The remove button is always visible rather than
 * revealed on hover: on a tablet it was invisible and still tappable. And each
 * photograph opens full size, because "is this one sharp enough" cannot be
 * answered from a sixty-pixel square — and it is the question that decides
 * whether the analysis is worth running at all.
 */
export default function EyeUploader({
  eye,
  images,
  onAdd,
  onRemove,
  onOpen,
}: {
  eye: Eye;
  images: PickedImage[];
  onAdd: (files: FileList | File[]) => void;
  onRemove: (id: string) => void;
  onOpen?: (index: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const isFull = images.length >= REQUIRED_IMAGES_PER_EYE;

  function openPicker() {
    if (!isFull) inputRef.current?.click();
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files?.length) onAdd(event.target.files);
    event.target.value = "";
  }

  const dragProps = {
    onDragOver: (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragging(true);
    },
    onDragLeave: (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragging(false);
    },
    onDrop: (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragging(false);
      if (e.dataTransfer.files?.length) onAdd(e.dataTransfer.files);
    },
  };

  return (
    <section className="rounded-xl border border-line">
      <header className="flex items-center justify-between border-b border-line bg-inset px-4 py-2.5">
        <h3 className="text-body font-medium text-ink">
          {eye} eye
          <span className="ml-2 text-ink-3">{EYE_ABBREVIATION[eye]}</span>
        </h3>
        <span
          className={cn(
            "text-label tabular-nums",
            isFull ? "text-steady" : "text-ink-3",
          )}
        >
          {images.length} / {REQUIRED_IMAGES_PER_EYE}
        </span>
      </header>

      <div className="p-4">
        {images.length === 0 ? (
          <div
            role="button"
            tabIndex={0}
            onClick={openPicker}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openPicker();
              }
            }}
            {...dragProps}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-colors",
              dragging ? "border-accent bg-inset" : "border-line hover:border-ink-3",
            )}
          >
            <Upload className="mb-3 size-6 text-ink-3" aria-hidden />
            <p className="text-body font-medium text-ink-2">
              Drop {REQUIRED_IMAGES_PER_EYE} photographs here
            </p>
            <p className="mt-1 text-label text-ink-3">or click to browse</p>
            <p className="mt-3 text-micro text-ink-3">JPEG or PNG</p>
          </div>
        ) : (
          <div
            {...dragProps}
            className={cn(
              "grid grid-cols-3 gap-2 rounded-xl",
              dragging && "ring-2 ring-accent ring-offset-2",
            )}
          >
            {images.map((image, i) => (
              <figure
                key={image.id}
                className="relative aspect-square overflow-hidden rounded-lg border border-line bg-[#05070c]"
              >
                <button
                  type="button"
                  onClick={() => onOpen?.(i)}
                  aria-label={`Open ${eye.toLowerCase()} eye photograph ${i + 1}`}
                  className="size-full cursor-zoom-in"
                >
                  <img
                    src={image.preview}
                    alt={`${eye} eye, photograph ${i + 1}`}
                    className="size-full object-cover"
                  />
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(image.id)}
                  aria-label={`Remove ${eye.toLowerCase()} eye photograph ${i + 1}`}
                  title="Remove"
                  className="absolute right-1 top-1 flex size-6 cursor-pointer items-center justify-center rounded-md bg-black/65 text-white transition-colors hover:bg-urgent"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </figure>
            ))}

            {!isFull && (
              <button
                type="button"
                onClick={openPicker}
                className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-line text-ink-3 transition-colors hover:border-ink-3 hover:text-ink-2"
              >
                <Plus className="size-5" aria-hidden />
                <span className="text-micro font-medium">Add</span>
              </button>
            )}
          </div>
        )}

        <input
          type="file"
          ref={inputRef}
          onChange={handleFileChange}
          accept="image/jpeg,image/png"
          multiple
          className="hidden"
        />
      </div>
    </section>
  );
}
