import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ImportImagesDialog, OpenPatientDialog } from "@/components/workspace/Dialogs";
import { DetectionSession, JobSession } from "@/components/workspace/Sessions";
import { EmptyStage } from "@/components/workspace/Stage";
import type { WorkspaceNav } from "@/components/workspace/state";
import Workspace from "@/components/workspace/Workspace";
import { useTitle } from "@/hooks/useTitle";

/**
 * /app/workspace                     the empty Workspace: open a patient, or import images
 * /app/workspace?detection=<id>      a saved examination
 * /app/workspace?job=<id>[&patient=] imported images, not saved
 *
 * The address carries what is open, so a refresh lands on the same thing — for
 * as long as the analyser still holds an import.
 */
export default function WorkspacePage() {
  useTitle("Vessel Workspace");
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<"open" | "import" | null>(null);

  const detection = params.get("detection");
  const job = params.get("job");

  const nav: WorkspaceNav = {
    backLabel: detection ? "Back to the examination" : "Back to the app",
    onBack: () => navigate(detection ? `/app/detection/${detection}` : "/app"),
    onOpenPatient: () => setDialog("open"),
    onImportImages: () => setDialog("import"),
    paused: dialog !== null,
  };

  let content;
  if (detection) {
    content = <DetectionSession key={detection} id={detection} nav={nav} />;
  } else if (job) {
    content = <JobSession key={job} jobId={job} patientId={params.get("patient")} nav={nav} />;
  } else {
    content = (
      <Workspace
        session={null}
        nav={nav}
        stage={
          <EmptyStage
            onOpenPatient={() => setDialog("open")}
            onImportImages={() => setDialog("import")}
          />
        }
      />
    );
  }

  return (
    <>
      {content}
      {dialog === "open" && (
        <OpenPatientDialog
          onClose={() => setDialog(null)}
          onOpen={(id) => {
            setDialog(null);
            navigate(`/app/workspace?detection=${encodeURIComponent(id)}`);
          }}
        />
      )}
      {dialog === "import" && (
        <ImportImagesDialog
          onClose={() => setDialog(null)}
          onImported={(jobId, patientId) => {
            setDialog(null);
            navigate(
              `/app/workspace?job=${encodeURIComponent(jobId)}${
                patientId ? `&patient=${encodeURIComponent(patientId)}` : ""
              }`,
            );
          }}
        />
      )}
    </>
  );
}
