import { riskColor } from "@/lib/rop";
export default function RiskBar({
  percent,
  className = "",
}: {
  percent: number;
  className?: string;
}) {
  return (
    <div className={`h-2 bg-black/5 rounded-full overflow-hidden ${className}`}>
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${percent}%`, backgroundColor: riskColor(percent) }}
      />
    </div>
  );
}
