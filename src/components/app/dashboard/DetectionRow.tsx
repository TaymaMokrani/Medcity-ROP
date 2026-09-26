import { ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { type Detection, riskPercent, formatRisk } from "@/lib/detections";
import { formatShortDate } from "@/lib/format";
import { CHART } from "./tokens";

/**
 * One screening in the recent list.
 *
 * The risk bar is drawn in the one accent rather than on a green-to-red ramp:
 * the number is already there for anyone reading the row, and a colour scale
 * would be a second, coarser diagnosis sitting next to it. Flagged is the only
 * word on the row that takes a colour.
 */
export function DetectionRow({ detection }: { detection: Detection }) {
    const navigate = useNavigate();
    const percent = riskPercent(detection.risk);

    return (
        <tr
            onClick={() => {
                navigate(`/app/detection/${detection.id}`);
            }}
            className="group cursor-pointer border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50/70"
        >
            <td className="px-1 py-3 text-slate-900">{detection.patientName}</td>
            <td className="px-1 py-3 text-slate-500 tabular-nums">
                {formatShortDate(detection.date)}
            </td>
            <td className="px-1 py-3 text-slate-600">{detection.eye}</td>
            <td className="px-1 py-3">
                <span className="flex items-center gap-2.5">
                    <span className="h-1 w-12 overflow-hidden rounded-full bg-slate-100">
                        <span
                            className="block h-full rounded-full"
                            style={{
                                width: `${percent}%`,
                                backgroundColor: CHART.series,
                            }}
                        />
                    </span>
                    <span className="text-slate-600 tabular-nums">
                        {formatRisk(detection.risk)}
                    </span>
                </span>
            </td>
            <td className="px-1 py-3">
                <span
                    className={
                        detection.flagged ? "text-[#9a2a1e]" : "text-slate-400"
                    }
                >
                    {detection.flagged ? "Flagged" : "Not flagged"}
                </span>
            </td>
            <td className="px-1 py-3">
                <ChevronRight className="size-4 text-slate-300 transition-colors group-hover:text-slate-500" />
            </td>
        </tr>
    );
}
