import { Link } from "react-router-dom";
import {
  clinicalNotes,
  eyeName,
  type IcropAxis,
  type SeverityEye,
} from "@/lib/severity";
import { severityTone } from "@/components/app/ui/tone";
import AuthImage from "@/components/app/AuthImage";
import AnalyserNote from "../AnalyserNote";

const QUADRANT_ORDER = ["ST", "SN", "IT", "IN"];
const QUADRANT_NAMES: Record<string, string> = {
  ST: "Superior temporal",
  SN: "Superior nasal",
  IT: "Inferior temporal",
  IN: "Inferior nasal",
};

/**
 * One eye, answered before any of the working.
 *
 * The severity and what was found come first, then the picture the analysis
 * drew, then the three axes ICROP grades an eye on. Each axis says where its
 * answer came from: a grade the analyser measured, a zone it could only infer
 * and a grade the doctor typed are three different kinds of fact.
 *
 * The picture is the analysis's own rendering, shown flat. Nothing here is
 * clickable or measurable — that is the Workspace's job, and a half-interactive
 * copy of it would only be a worse one.
 */
export default function EyeSummaryCard({
  eye,
  detectionId,
}: {
  eye: SeverityEye;
  detectionId?: string;
}) {
  const tone = severityTone(eye.severity);
  const findings = clinicalNotes(eye.findings);
  // Superior before inferior, so the list reads down the eye.
  const quadrants = QUADRANT_ORDER.map(
    (key) => [key, eye.plus.quadrants?.[key]] as const,
  ).filter(
    (entry): entry is [string, NonNullable<(typeof entry)[1]>] =>
      entry[1] !== undefined,
  );
  // The joined map carries every traced vessel; the front picture only shows
  // how far the reading reached.
  const picture = eye.evidence.map ?? eye.evidence.front;

  return (
    <section className="overflow-hidden rounded-xl border border-line bg-panel">
      <header className="border-b border-line px-5 py-4">
        <p className="text-micro font-medium uppercase tracking-[0.16em] text-ink-3">
          {eyeName(eye.eye)} eye
        </p>
        <p className={`mt-2 font-heading text-title ${tone.text}`}>
          {tone.label}
        </p>
        {findings.map((finding) => (
          <AnalyserNote key={finding} text={finding} />
        ))}
      </header>

      {picture && (
        <figure className="m-0 border-b border-line-soft">
          <AuthImage
            src={picture}
            alt={`${eyeName(eye.eye)} eye, as the analysis drew it`}
            className="max-h-72 w-full bg-[#05070c] object-contain"
            frameClassName="h-72"
          />
          <figcaption className="px-5 py-3 text-label text-ink-3">
            {detectionId ? (
              <Link
                to={`/app/workspace?detection=${detectionId}`}
                className="underline-offset-4 hover:text-ink hover:underline"
              >
                Visit the Workspace for all the data and more detail
              </Link>
            ) : (
              "The Workspace has all the data and more detail."
            )}
          </figcaption>
        </figure>
      )}

      <dl className="grid grid-cols-3 divide-x divide-line-soft">
        <Axis label="Zone" axis={eye.icrop.zone} />
        <Axis label="Stage" axis={eye.icrop.stage} />
        <Axis label="Plus" axis={eye.icrop.plus} />
      </dl>

      {/* Where the plus disease is. This was folded away twice over — inside a
          disclosure, inside another section — and it is the only thing on the
          page that says which side of the eye is affected. */}
      {quadrants.length > 0 && (
        <div className="border-t border-line-soft px-5 py-4">
          <p className="text-micro font-medium uppercase tracking-[0.16em] text-ink-3">
            Quadrants
          </p>
          <dl className="mt-3 divide-y divide-line-soft">
            {quadrants.map(([key, quadrant]) => (
              <div
                key={key}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2"
              >
                <dt className="text-body text-ink-2">
                  {QUADRANT_NAMES[key] ?? key}
                </dt>
                <dd className="text-right text-body tabular-nums">
                  {quadrant.measured ? (
                    <>
                      <span
                        className={
                          quadrant.abnormal ? "text-urgent" : "text-ink-2"
                        }
                      >
                        {quadrant.abnormal ? "Abnormal" : "Normal"}
                      </span>
                      <span className="ml-3 text-label text-ink-3">
                        CTI {quadrant.cti?.toFixed(3)} ·{" "}
                        {quadrant.diameter_p90?.toFixed(1)} px
                      </span>
                    </>
                  ) : (
                    <span className="text-ink-3">Not measured</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <p className="border-t border-line-soft px-5 py-3 text-label text-ink-3 tabular-nums">
        {eye.n_aligned} of {eye.n_images} photographs aligned · optic disc{" "}
        {eye.optic_disc.found ? "found" : "not found"}
      </p>
    </section>
  );
}

function Axis({ label, axis }: { label: string; axis: IcropAxis }) {
  const measured = axis.source === "measured";
  const source =
    axis.source === "clinician"
      ? "yours"
      : axis.source === "measured"
        ? axis.provisional
          ? "suggested"
          : null
        : "not assessable";

  return (
    <div className="px-5 py-4">
      <dt className="text-label text-ink-3">{label}</dt>
      <dd
        className={`mt-1 font-heading text-lead capitalize tabular-nums ${
          measured ? "text-ink" : "text-ink-3"
        }`}
      >
        {axis.value ?? "—"}
      </dd>
      {source && <dd className="mt-0.5 text-label text-ink-3">{source}</dd>}
    </div>
  );
}
