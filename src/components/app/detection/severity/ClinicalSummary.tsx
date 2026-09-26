import { eyeName, worstEyeFirst, type SeveritySummary } from "@/lib/severity";
import { severityTone } from "@/components/app/ui/tone";

/**
 * The answer, before any of the working.
 *
 * Three facts, split across one row: how severe, which eyes, and how soon the
 * baby has to be seen. A clinician who reads nothing else on this screen should
 * still leave knowing those three, so they are set large and given equal room,
 * and colour falls on exactly one word — the severity.
 *
 * They used to run down the page as a headline, a caption and a paragraph, with
 * the action — the only part that says what to do — set smallest of the three.
 *
 * Three facts and nothing else. The analyser's running commentary underneath
 * them — which eye the urgency came from, what it could not assess — said in
 * prose what the eye cards below say in their own grades.
 */
export default function ClinicalSummary({
  summary,
}: {
  summary: SeveritySummary;
}) {
  const ordered = worstEyeFirst(summary.eyes);
  const single = ordered.length === 1 ? ordered[0] : null;

  const headline = single
    ? {
        severity: single.severity,
        action: single.action,
        caption: `${eyeName(single.eye)} eye`,
      }
    : {
        severity: summary.patient.severity,
        action: summary.patient.action,
        caption: "Both eyes",
      };

  const tone = severityTone(headline.severity);

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-panel">
      <dl className="grid divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Split label="Severity">
          <span className={`font-heading text-title ${tone.text}`}>
            {tone.label}
          </span>
        </Split>
        <Split label="Eyes">
          <span className="font-heading text-title text-ink">
            {headline.caption}
          </span>
        </Split>
        <Split label="Action">
          <span className="font-heading text-title leading-tight text-ink first-letter:uppercase">
            {headline.action}
          </span>
        </Split>
      </dl>
    </div>
  );
}

function Split({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-5 py-4">
      <dt className="text-micro font-medium uppercase tracking-[0.16em] text-ink-3">
        {label}
      </dt>
      <dd className="mt-2">{children}</dd>
    </div>
  );
}
