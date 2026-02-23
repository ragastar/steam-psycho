import type { AggregatedProfile } from "@/lib/aggregation/types";

interface PatternsGridProps {
  patterns: AggregatedProfile["patterns"];
  labels: {
    title: string;
    genreConcentration: string;
    genreConcentrationDesc: string;
    bingeStyle: string;
    bingeDesc: string;
    indieGames: string;
    indieDesc: string;
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
      <div className="space-y-4">
        {/* Genre concentration */}
        <div className="flex items-start gap-3">
          <div className="min-w-[56px] text-center">
            <p className="text-2xl font-bold font-mono text-white">{patterns.genreConcentration}%</p>
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-gray-300">{labels.genreConcentration}</p>
            <p className="text-xs text-gray-500 leading-relaxed">{labels.genreConcentrationDesc}</p>
          </div>
        </div>

        {/* Binge style */}
        <div className="flex items-start gap-3">
          <div className="min-w-[56px] text-center">
            <p className="text-2xl">{bingeIcon}</p>
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-gray-300">{bingeLabel}</p>
            <p className="text-xs text-gray-500 leading-relaxed">{labels.bingeDesc}</p>
          </div>
        </div>

        {/* Indie */}
        <div className="flex items-start gap-3">
          <div className="min-w-[56px] text-center">
            <p className="text-2xl font-bold font-mono text-white">{patterns.indiePercentage}%</p>
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-gray-300">{labels.indieGames}</p>
            <p className="text-xs text-gray-500 leading-relaxed">{labels.indieDesc}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
