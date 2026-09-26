import { Lock } from "lucide-react";
import {
  QUADRANTS,
  QUADRANT_NAMES,
  eyeLabel,
  fmt,
  photoCount,
  type WsEye,
  type WsSummary,
} from "@/lib/workspace";
import type { Severity } from "@/lib/severity";
import { cn } from "@/lib/utils";
import { Note, Section } from "../ui";

const SEVERITY_TONE: Record<Severity, { label: string; className: string }> = {
  severe: { label: "Severe", className: "border-rose-400/40 bg-rose-400/10 text-rose-200" },
  intermediate: {
    label: "Intermediate",
    className: "border-amber-400/40 bg-amber-400/10 text-amber-200",
  },
  lower: { label: "Lower", className: "border-emerald-400/40 bg-emerald-400/10 text-emerald-200" },
  // not a milder point on the same scale — the absence of an answer
  unknown: {
    label: "Could not assess",
    className: "border-violet-400/40 bg-violet-400/10 text-violet-200",
  },
};

/**
 * What the analyser concluded about this eye, with the reason beside each part.
 *
 * An import has not been through Phase 1, so it gets measurements and the plus
 * score only — no severity, no action. A saved examination gets the full
 * assessment it already carries on its detection page.
 */
export default function SummaryPanel({
  eye,
  summary,
  screened,
  title,
  subtitle,
}: {
  eye: WsEye;
  summary: WsSummary;
  screened: boolean;
  title: string;
  subtitle: string;
}) {
  const photos = photoCount(eye);
  const single = photos < 2;
  const index = eye.plus?.index;
  const rule = eye.plus?.quadrant_rule;

  return (
    <div>
      <Section title={screened ? "Examination" : "Imported images"}>
        <p className="text-body text-ink">{title}</p>
        <p className="mt-0.5 text-micro text-ink-3">{subtitle}</p>
      </Section>

      {screened && eye.severity ? (
        <Section title={`${eyeLabel(eye.eye)} eye · assessment`}>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-label font-medium",
                SEVERITY_TONE[eye.severity].className,
              )}
            >
              {SEVERITY_TONE[eye.severity].label}
            </span>
            {eye.action && <span className="text-label text-ink/85">{eye.action}</span>}
          </div>
          <p className="mt-2 text-micro text-ink-3">
            Provisional — decision support, not a diagnosis.
          </p>
        </Section>
      ) : (
        <Section title={`${eyeLabel(eye.eye)} eye`}>
          <Note tone="amber">
            Not screened by Phase 1. These are measurements only — no severity and no
            action are given for this eye.
          </Note>
        </Section>
      )}

      <Section title="Plus score">
        {index?.assessable && typeof index.score === "number" ? (
          <PlusScore
            score={index.score}
            cutPre={index.cut_preplus ?? 0.221}
            cutPlus={index.cut_plus ?? 0.325}
          />
        ) : (
          <p className="text-label text-ink-3">
            {index?.reason ?? "The plus score could not be computed for this eye."}
          </p>
        )}
        {single && (
          <div className="mt-3">
            <Note tone="amber">
              Based on 1 photograph — less reliable. The score averages the vessels it
              can see, and one photograph sees fewer.
            </Note>
          </div>
        )}
        <p className="mt-3 text-micro leading-snug text-ink-3">
          Built from two measurements: integrated curvature and mean vessel width.
          Both raise the score. Sensitivity 0.89, specificity 0.76 on 633 eye-visits —
          from a single grader’s labels.
        </p>
      </Section>

      <Section title="Quadrant rule · ICROP">
        {rule?.n_quadrants_measured ? (
          <p className="text-body text-ink">
            {rule.n_abnormal_quadrants ?? 0} of {rule.n_quadrants_measured} quadrants
            abnormal
            <span className="block text-micro text-ink-3">
              Abnormal = tortuous AND dilated. 1 is pre-plus, 2 or more is plus.
            </span>
          </p>
        ) : (
          <p className="text-label text-ink-3">
            Needs an optic disc to split the retina into quadrants.
          </p>
        )}
        {eye.plus?.quadrants && (
          <div className="mt-3 grid grid-cols-2 gap-1.5">
            {QUADRANTS.map((q) => {
              const value = eye.plus?.quadrants?.[q];
              const abnormal = value?.measured && value.abnormal;
              return (
                <div
                  key={q}
                  title={QUADRANT_NAMES[q]}
                  className={cn(
                    "rounded-md border px-2.5 py-1.5",
                    abnormal
                      ? "border-rose-400/40 bg-rose-400/[0.08]"
                      : "border-line bg-white/[0.02]",
                  )}
                >
                  <p className="flex items-center justify-between text-micro">
                    <span className={abnormal ? "text-rose-200" : "text-ink/85"}>{q}</span>
                    <span className="text-micro text-ink-3">
                      {value?.measured ? (abnormal ? "abnormal" : "normal") : "not measured"}
                    </span>
                  </p>
                  {value?.measured && (
                    <p className="mt-0.5 text-micro tabular-nums text-ink-3">
                      CTI {fmt(value.cti, 3)} · {fmt(value.diameter_p90, 1)} px
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {screened && eye.plus?.grade && (
          <p className="mt-3 text-label text-ink/85">
            Plus grade: <span className="text-ink">{eye.plus.grade}</span>
            <span className="text-ink-3">
              {eye.plus.escalated_by === "quadrant_rule"
                ? " — raised by the quadrant rule above the score"
                : " — from the score"}
            </span>
          </p>
        )}
      </Section>

      <Section title="Zone">
        {single ? (
          <LockedNote>
            Upload other angle shots (2–5) of this eye to assess the zone. It needs the
            photographs joined into one map.
          </LockedNote>
        ) : eye.zone?.assessable ? (
          <p className="text-body text-ink">
            Zone {eye.zone.most_posterior_zone}
            <span className="ml-2 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2 py-0.5 text-micro text-emerald-200">
              verified
            </span>
          </p>
        ) : eye.zone?.suggested?.zone ? (
          <div className="space-y-2.5">
            <p className="text-body text-ink">
              Zone {eye.zone.suggested.zone}
              <span className="ml-2 rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-micro text-amber-200">
                suggestion, not measured
              </span>
            </p>
            {eye.zone.suggested.caveat && <Note tone="amber">{eye.zone.suggested.caveat}</Note>}
            <p className="text-micro text-ink-3">
              {eye.zone.suggested.n_directions_verified ?? 0} of{" "}
              {eye.zone.suggested.n_directions_with_a_front ?? 0} directions verified.
              See “Coverage” below the picture: green is verified, amber is where the
              vessels ran off the photograph.
            </p>
          </div>
        ) : (
          <p className="text-label text-ink-3">
            Not assessable{eye.zone?.reason ? ` — ${eye.zone.reason}` : ""}. This is not
            the same as finding no Zone I disease.
          </p>
        )}
      </Section>

      <Section title="Stage">
        <p className="text-label leading-relaxed text-ink-3">
          Not measured. Staging needs the demarcation line or the ridge, which this
          analysis does not detect. It is entered by the examining clinician.
        </p>
      </Section>

      <Section title="Photographs">
        <p className="text-label text-ink/90">
          {photos} measured{eye.n_aligned != null && photos > 1 ? ` · ${eye.n_aligned} aligned into the map` : ""}
        </p>
        {eye.level_meaning && (
          <p className="mt-1 text-micro text-ink-3">{capitalise(eye.level_meaning)}.</p>
        )}
        {eye.per_image?.some((p) => p.status !== "ok") && (
          <ul className="mt-2 space-y-1 text-micro">
            {eye.per_image
              .filter((p) => p.status !== "ok")
              .map((p) => (
                <li key={p.index} className="text-amber-200/85">
                  Photograph {p.index + 1}: {p.status}
                  {p.quality_reasons?.length
                    ? ` — ${p.quality_reasons.join(", ").replaceAll("_", " ")}`
                    : ""}
                </li>
              ))}
          </ul>
        )}
      </Section>

      {screened && eye.findings && eye.findings.length > 0 && (
        <Section title="Analyser’s notes">
          <ul className="space-y-2 text-micro leading-relaxed text-ink-3">
            {eye.findings.map((finding) => (
              <li key={finding}>{finding}</li>
            ))}
          </ul>
        </Section>
      )}

      {summary.provisional_note && (
        <Section title="About these numbers">
          <p className="text-micro leading-relaxed text-ink-3">{summary.provisional_note}</p>
        </Section>
      )}
    </div>
  );
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function LockedNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex gap-2.5 text-label leading-relaxed text-ink-3">
      <Lock className="mt-0.5 size-3.5 shrink-0 text-amber-300/80" strokeWidth={1.8} />
      <span>{children}</span>
    </p>
  );
}

/** The score on its own scale, with the two cut-offs marked. */
function PlusScore({ score, cutPre, cutPlus }: { score: number; cutPre: number; cutPlus: number }) {
  // wide enough that a clearly-plus score still sits inside the bar
  const min = -0.2;
  const max = 1.0;
  const at = (v: number) => `${((Math.min(max, Math.max(min, v)) - min) / (max - min)) * 100}%`;
  const band = score >= cutPlus ? "plus" : score >= cutPre ? "pre-plus" : "normal";

  return (
    <div>
      <p className="flex items-baseline gap-2">
        <span className="text-[22px] font-light tabular-nums text-ink">{score.toFixed(3)}</span>
        <span
          className={cn(
            "text-label",
            band === "plus" ? "text-rose-300" : band === "pre-plus" ? "text-amber-200" : "text-emerald-200",
          )}
        >
          {band} range
        </span>
      </p>
      <div className="relative mt-3 h-1.5 rounded-full bg-gradient-to-r from-emerald-400/35 via-amber-300/35 to-rose-400/50">
        <span className="absolute -top-1 h-3.5 w-px bg-white/40" style={{ left: at(cutPre) }} />
        <span className="absolute -top-1 h-3.5 w-px bg-white/70" style={{ left: at(cutPlus) }} />
        <span
          className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg bg-white shadow"
          style={{ left: at(score) }}
        />
      </div>
      <div className="relative mt-1.5 h-4 text-micro tabular-nums text-ink-3">
        <span className="absolute -translate-x-full pr-1.5" style={{ left: at(cutPre) }}>
          pre-plus {cutPre}
        </span>
        <span className="absolute pl-1.5" style={{ left: at(cutPlus) }}>
          plus {cutPlus}
        </span>
      </div>
    </div>
  );
}
