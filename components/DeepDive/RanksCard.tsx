import type { AggregatedProfile } from "@/lib/aggregation/types";

interface RanksCardProps {
  ranks: AggregatedProfile["ranks"];
  labels: {
    title: string;
    hours: string;
    library: string;
    concentration: string;
    veteran: string;
  };
}

export function RanksCard({ ranks, labels }: RanksCardProps) {
  const items = [
    { label: labels.hours, value: ranks.hoursPercentile },
    { label: labels.library, value: ranks.librarySizePercentile },
    { label: labels.concentration, value: ranks.concentrationPercentile },
    { label: labels.veteran, value: ranks.veteranPercentile },
  ];

  return (
    <div className="bg-gray-900/50 rounded-xl p-4 border border-gray-800">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">{labels.title}</h3>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.label}>
            <div className="flex justify-between text-xs mb-0.5">
              <span className="text-gray-400">{item.label}</span>
              <span className="text-gray-300 font-mono">Top {100 - item.value}%</span>
            </div>
            <div className="w-full bg-gray-800 rounded-full h-2">
              <div
                className="bg-gradient-to-r from-cyan-500 to-purple-500 rounded-full h-2"
                style={{ width: `${item.value}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
