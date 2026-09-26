import { useState } from "react";
import { Stethoscope, Check } from "lucide-react";
import {
  setDoctorDecision,
  DOCTOR_DECISIONS,
  type Detection,
  type DoctorDecision,
} from "@/lib/detections";
import { errorMessage } from "@/lib/api";
import { formatDate } from "@/lib/format";

const CHOICES = DOCTOR_DECISIONS.filter((d) => d !== "Pending");

export default function DoctorDecisionCard({
  detection,
  onDecided,
}: {
  detection: Detection;
  onDecided: (updated: Detection) => void;
}) {
  const [saving, setSaving] = useState<DoctorDecision | null>(null);
  const [error, setError] = useState("");
  const current = detection.doctorDecision ?? "Pending";

  async function choose(decision: DoctorDecision) {
    setSaving(decision);
    setError("");
    try {
      onDecided(await setDoctorDecision(detection.id, decision));
    } catch (e) {
      setError(errorMessage(e, "Could not save your decision."));
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="border border-gray-200 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
        <Stethoscope size={16} className="text-gray-500" />
        Your conclusion
      </h3>
      <div className="flex flex-wrap gap-2 mt-4">
        {CHOICES.map((choice) => {
          const active = current === choice;
          return (
            <button
              key={choice}
              onClick={() => choose(choice)}
              disabled={saving !== null}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium cursor-pointer transition-all disabled:opacity-50 ${
                active
                  ? "bg-black text-white shadow-sm"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {active && <Check size={14} />}
              {choice}
            </button>
          );
        })}
      </div>

      {current !== "Pending" && detection.decidedAt && (
        <p className="text-xs text-gray-400 mt-3">
          Recorded {formatDate(detection.decidedAt)}
        </p>
      )}
      {error && <p className="text-xs text-red-600 mt-3">{error}</p>}
    </div>
  );
}
