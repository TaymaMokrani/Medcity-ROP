import type { ImgHTMLAttributes } from "react";
import { ImageOff } from "lucide-react";
import { useAsset } from "@/lib/assets";
import { cn } from "@/lib/utils";

/**
 * A photograph, fetched with the session's token.
 *
 * Everywhere a retinal photograph or an evidence render is shown. It looks
 * like an `<img>` and takes the same props, but `src` is the storage key the
 * record holds — `detections/…` — not something the browser can load on its
 * own. See `lib/assets.ts` for why.
 *
 * Three states, and the third one matters: a picture that failed says so.
 * An empty frame where a retina should be reads as "this eye looks clear",
 * which is the one thing it must never be mistaken for.
 */
export default function AuthImage({
  src,
  alt,
  className,
  frameClassName,
  ...rest
}: {
  src?: string | null;
  alt: string;
  /** Sits on the placeholder and on the failure box, so both match the image. */
  frameClassName?: string;
} & Omit<ImgHTMLAttributes<HTMLImageElement>, "src">) {
  const { url, loading, failed } = useAsset(src);

  if (loading) {
    return (
      <div
        className={cn("animate-pulse bg-inset", className, frameClassName)}
        aria-label={`${alt} — loading`}
        role="img"
      />
    );
  }

  if (failed || !url) {
    return (
      <div
        role="img"
        aria-label={`${alt} — could not be loaded`}
        className={cn(
          "flex flex-col items-center justify-center gap-1.5 bg-inset px-4 py-6 text-center",
          className,
          frameClassName,
        )}
      >
        <ImageOff className="size-4 text-ink-3" aria-hidden />
        <p className="text-micro leading-snug text-ink-3">
          This picture could not be loaded
        </p>
      </div>
    );
  }

  return <img src={url} alt={alt} className={className} {...rest} />;
}
