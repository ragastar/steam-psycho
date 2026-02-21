import type { AggregatedProfile } from "@/lib/aggregation/types";

interface PatternsGridProps {
  patterns: AggregatedProfile["patterns"];
  labels: {
    title: string;
    genreConcentration: string;
    bingeStyle: string;
    indieGames: string;
    binger: string;
    sampler: string;
    balanced: string;
  };
}

export function PatternsGrid({ patterns, labels }: PatternsGridProps) {
  const bingeLabel = {
    binger: labels.binger,
    sampler: labels.sampler,
    balanced: labels.balanced,
  }[patterns.bingeStyle];

  const bingeIcon = {
    binger: "🔥",
    sampler: "🦋",
    balanced: "⚖️",
  }[patterns.bingeStyle];

  return (
    <div className="bg-gray-900/50 rounded-xl p-4 border border-gray-800">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">{labels.title}</h3>
      <div className="grid grid-cols-3 gap-3">
        <div className="text-center">
          <p className="text-2xl font-bold font-mono text-white">{patterns.genreConcentration}%</p>
          <p className="text-xs text-gray-500">{labels.genreConcentration}</p>
        </div>
        <div className="text-center">
          <p className="text-lg">{bingeIcon}</p>
          <p className="text-sm font-semibold text-gray-300">{bingeLabel}</p>
          <p className="text-xs text-gray-500">{labels.bingeStyle}</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold font-mono text-white">{patterns.indiePercentage}%</p>
          <p className="text-xs text-gray-500">{labels.indieGames}</p>
        </div>
      </div>
    </div>
  );
}
