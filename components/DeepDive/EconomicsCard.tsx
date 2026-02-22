import type { AggregatedProfile } from "@/lib/aggregation/types";

interface EconomicsCardProps {
  economics: AggregatedProfile["economics"];
  labels: {
    title: string;
    libraryValue: string;
    wasted: string;
    freeGames: string;
    disclaimer: string;
  };
}

export function EconomicsCard({ economics, labels }: EconomicsCardProps) {
  return (
    <div className="bg-gray-900/50 rounded-xl p-4 border border-gray-800">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">{labels.title}</h3>
      <div className="grid grid-cols-3 gap-3">
        <Metric label={labels.libraryValue} value={`$${economics.totalLibraryValue}`} />
        <Metric label={labels.wasted} value={`$${economics.wastedValue}`} accent="text-red-400" />
        <Metric label={labels.freeGames} value={`${economics.freePercentage}%`} />
      </div>
      <p className="text-[10px] text-gray-600 mt-3 pt-2 border-t border-gray-800/50 italic">
        {labels.disclaimer}
      </p>
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-lg font-bold font-mono ${accent || "text-white"}`}>{value}</p>
    </div>
  );
}
