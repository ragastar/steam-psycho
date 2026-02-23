import type { AggregatedProfile } from "@/lib/aggregation/types";

interface RanksCardProps {
  ranks: AggregatedProfile["ranks"];
  labels: {
    title: string;
    subtitle: string;
    hours: string;
    hoursDesc: string;
    library: string;
    libraryDesc: string;
    concentration: string;
    concentrationDesc: string;
    veteran: string;
    veteranDesc: string;
  };
}

export function RanksCard({ ranks, labels }: RanksCardProps) {
  const items = [
    { label: labels.hours, desc: labels.hoursDesc, value: ranks.hoursPercentile },
    { label: labels.library, desc: labels.libraryDesc, value: ranks.librarySizePercentile },
    { label: labels.concentration, desc: labels.concentrationDesc, value: ranks.concentrationPercentile },
    { label: labels.veteran, desc: labels.veteranDesc, value: ranks.veteranPercentile },
  ];

  return (
    <div className="bg-gray-900/50 rounded-xl p-4 border border-gray-800">
      <h3 className="text-sm font-semibold text-gray-300 mb-1">{labels.title}</h3>
      <p className="text-[10px] text-gray-600 mb-3">{labels.subtitle}</p>
      <div className="space-y-3">
        {items.map((item) => {
          const top = 100 - item.value;
          return (
            <div key={item.label}>
              <div className="flex justify-between text-xs mb-0.5">
                <span className="text-gray-300 font-medium">{item.label}</span>
                <span className={`font-mono font-bold ${top <= 5 ? "text-yellow-400" : top <= 20 ? "text-purple-400" : "text-gray-300"}`}>
                  Top {top}%
                </span>
              </div>
              <div className="w-full bg-gray-800 rounded-full h-2.5 mb-1">
                <div
                  className={`rounded-full h-2.5 ${
                    top <= 5 ? "bg-gradient-to-r from-yellow-500 to-amber-500" :
                    top <= 20 ? "bg-gradient-to-r from-purple-500 to-pink-500" :
                    "bg-gradient-to-r from-cyan-500 to-purple-500"
                  }`}
                  style={{ width: `${item.value}%` }}
                />
              </div>
              <p className="text-[10px] text-gray-600">{item.desc}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
