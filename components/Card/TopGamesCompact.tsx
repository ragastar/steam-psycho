import type { AggregatedProfile } from "@/lib/aggregation/types";

interface TopGamesCompactProps {
  games: AggregatedProfile["topGames"];
  barClass: string;
}

export function TopGamesCompact({ games, barClass }: TopGamesCompactProps) {
  const top5 = games.slice(0, 5);
  const maxHours = top5[0]?.playtimeHours || 1;

  return (
    <div className="space-y-3">
      {top5.map((game) => {
        const pct = Math.round((game.playtimeHours / maxHours) * 100);
        return (
          <div key={game.appid} className="space-y-1">
            {/* Row 1: Name + hours */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-gray-300 truncate font-medium">{game.name}</span>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-xs text-gray-400 font-mono">{game.playtimeHours}h</span>
                {game.vsAverage && (
                  <span className={`text-[10px] font-mono ${game.vsAverage > 2 ? "text-red-400" : game.vsAverage > 1 ? "text-yellow-400" : "text-green-400"}`}>
                    {game.vsAverage}x
                  </span>
                )}
                {game.isFree && (
                  <span className="text-[9px] bg-green-900/50 text-green-400 px-1 rounded">F2P</span>
                )}
                {game.achievementRate !== undefined && (
                  <span className="text-[10px] text-gray-500 font-mono">{game.achievementRate}%</span>
                )}
              </div>
            </div>
            {/* Row 2: Progress bar */}
            <div className="w-full bg-gray-800 rounded-full h-1.5">
              <div
                className={`bg-gradient-to-r ${barClass} rounded-full h-1.5`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
