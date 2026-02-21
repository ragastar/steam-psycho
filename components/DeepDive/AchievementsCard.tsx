import type { AggregatedProfile } from "@/lib/aggregation/types";

interface AchievementsCardProps {
  achievements: AggregatedProfile["achievements"];
  labels: { title: string; completion: string; rarest: string; noData: string };
}

export function AchievementsCard({ achievements, labels }: AchievementsCardProps) {
  if (achievements.topGames.length === 0) {
    return (
      <div className="bg-gray-900/50 rounded-xl p-4 border border-gray-800">
        <h3 className="text-sm font-semibold text-gray-300 mb-2">{labels.title}</h3>
        <p className="text-xs text-gray-600">{labels.noData}</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-900/50 rounded-xl p-4 border border-gray-800">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">{labels.title}</h3>
      <div className="space-y-2">
        {achievements.topGames.map((game) => (
          <div key={game.name} className="flex items-center gap-2">
            <span className="text-xs text-gray-400 w-28 truncate text-right">{game.name}</span>
            <div className="flex-1 bg-gray-800 rounded-full h-2">
              <div
                className="bg-gradient-to-r from-emerald-500 to-cyan-500 rounded-full h-2"
                style={{ width: `${game.completionRate}%` }}
              />
            </div>
            <span className="text-xs text-gray-500 font-mono w-10 text-right">{game.completionRate}%</span>
            {game.rarest && (
              <span className="text-[10px] text-yellow-500 font-mono">
                {game.rarest.percent}%
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
