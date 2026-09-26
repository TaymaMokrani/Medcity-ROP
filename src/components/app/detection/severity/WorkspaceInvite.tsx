import { Link } from "react-router-dom";
import { ArrowRight, ScanEye } from "lucide-react";
import AuthImage from "@/components/app/AuthImage";

/**
 * The way into the Vessel Workspace.
 *
 * It was one sentence in a caption under two pictures, and nobody found it.
 * Then it was a white card among white cards, which is only slightly better: a
 * link that looks like the panels around it reads as another panel.
 *
 * So it is the one dark thing on the page, in the Workspace's own colours. It
 * is not decoration — the Workspace is a dark room and this is a window into
 * it, so the card shows where the click leads before the click happens.
 */
export default function WorkspaceInvite({
  detectionId,
  preview,
}: {
  detectionId: string;
  /** A rendered map from the analysis, if it produced one. */
  preview?: string;
}) {
  return (
    <Link
      to={`/app/workspace?detection=${detectionId}`}
      className="group relative flex items-center gap-6 overflow-hidden rounded-xl border border-medcity-cyan/25 bg-medcity-void p-5 transition-colors hover:border-medcity-cyan/60"
    >
      {/* A wash of the Workspace's accent, brightening on approach. */}
      <span
        className="pointer-events-none absolute -left-24 -top-24 size-64 rounded-full opacity-50 blur-3xl transition-opacity duration-300 group-hover:opacity-90"
        style={{ background: "rgba(56, 189, 248, 0.22)" }}
        aria-hidden
      />

      {preview && (
        <span className="relative size-24 shrink-0 overflow-hidden rounded-lg border border-medcity-cyan/20">
          <AuthImage
            src={preview}
            alt=""
            className="size-full object-cover opacity-75 transition-all duration-300 group-hover:scale-105 group-hover:opacity-100"
            frameClassName="size-full"
          />
        </span>
      )}

      <span className="relative min-w-0 flex-1">
        <span className="flex items-center gap-2 text-micro font-medium uppercase tracking-[0.16em] text-medcity-cyan">
          <ScanEye className="size-4" aria-hidden />
          Vessel Workspace
        </span>
        <span className="mt-2 block font-heading text-title text-medcity-ice">
          Look at the vessels themselves
        </span>
        <span className="mt-1.5 block text-label leading-relaxed text-medcity-muted">
          Every vessel the analyser traced, drawn over the original photograph,
          with the measurements each grade was read from.
        </span>
      </span>

      <span className="relative flex size-10 shrink-0 items-center justify-center rounded-full border border-medcity-cyan/30 text-medcity-cyan transition-all duration-300 group-hover:border-medcity-cyan group-hover:bg-medcity-cyan/10">
        <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </span>
    </Link>
  );
}
