import { worstEyeFirst, type SeveritySummary } from "@/lib/severity";
import ClinicalSummary from "./ClinicalSummary";
import EyeSummaryCard from "./EyeSummaryCard";
import WorkspaceInvite from "./WorkspaceInvite";

/**
 * A finished assessment, in three tiers.
 *
 * First the verdict, in three facts. Then each eye: what was found, the
 * picture the analysis drew, the three ICROP axes and the quadrant the plus
 * disease is in. Then the way into the Workspace.
 *
 * There is no separate band of working any more. Everything a doctor acts on
 * is on the eye it belongs to, and everything else — the per-image breakdown,
 * the cut-off scales, the methodology — is in the Workspace, which is built
 * for exactly that and does it better than a fold on this page could.
 */
export default function SeverityResults({
  summary,
  detectionId,
}: {
  summary: SeveritySummary;
  /**
   * Absent while a screening is still being made: nothing is saved yet, so
   * there is no Workspace to open and the invitation is not shown.
   */
  detectionId?: string;
}) {
  const ordered = worstEyeFirst(summary.eyes);
  const single = ordered.length === 1;
  const preview = ordered.find((eye) => eye.evidence.map)?.evidence.map;

  return (
    <div className="mt-6">
      <ClinicalSummary summary={summary} />

      <div
        className={`mt-8 grid gap-6 ${single ? "" : "lg:grid-cols-2"}`}
      >
        {ordered.map((eye) => (
          <EyeSummaryCard key={eye.eye} eye={eye} detectionId={detectionId} />
        ))}
      </div>

      {detectionId && (
        <div className="mt-6">
          <WorkspaceInvite detectionId={detectionId} preview={preview} />
        </div>
      )}

    </div>
  );
}
