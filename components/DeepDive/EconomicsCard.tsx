import type { AggregatedProfile } from "@/lib/aggregation/types";

interface LibraryOverviewCardProps {
  stats: AggregatedProfile["stats"];
  multiplayerRatio: number;
  singleplayerRatio: number;
  freePercentage: number;
  labels: {
    title: string;
    played: string;
    unplayed: string;
    avgPerGame: string;
    multiplayer: string;
    singleplayer: string;
    freeGames: string;
    hours: string;
  };
}

export function EconomicsCard({
  stats,
  multiplayerRatio,
  freePercentage,
  labels,
}: LibraryOverviewCardProps) {
  const playedPct = 100 - stats.unplayedPercentage;

  return (
    <div className="bg-gray-900/50 rounded-xl p-4 border border-gray-800">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">{labels.title}</h3>

      {/* Played vs Unplayed bar */}
      <div className="mb-4">
        <div className="flex justify-between text-xs mb-1">
          <span className="text-emerald-400">{labels.played} {playedPct}%</span>
          <span className="text-gray-500">{labels.unplayed} {stats.unplayedPercentage}%</span>
        </div>
        <div className="w-full bg-gray-800 rounded-full h-3 flex overflow-hidden">
          <div
            className="bg-gradient-to-r from-emerald-500 to-cyan-500 rounded-l-full h-3"
            style={{ width: `${playedPct}%` }}
          />
          <div
            className="bg-gray-700 h-3"
            style={{ width: `${stats.unplayedPercentage}%` }}
          />
        </div>
        <p className="text-[10px] text-gray-600 mt-1">
          {stats.totalGames - stats.unplayedCount} / {stats.totalGames}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="text-center">
          <p className="text-xl font-bold font-mono text-white">{stats.avgPlaytimeHours}</p>
          <p className="text-[10px] text-gray-500 leading-tight">{labels.avgPerGame}</p>
        </div>
        <div className="text-center">
          <p className="text-xl font-bold font-mono text-cyan-400">{multiplayerRatio}%</p>
          <p className="text-[10px] text-gray-500 leading-tight">{labels.multiplayer}</p>
        </div>
        <div className="text-center">
          <p className="text-xl font-bold font-mono text-gray-400">{freePercentage}%</p>
          <p className="text-[10px] text-gray-500 leading-tight">{labels.freeGames}</p>
        </div>
      </div>
    </div>
  );
}
