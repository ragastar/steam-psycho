import type { AggregatedProfile } from "@/lib/aggregation/types";

interface TopGamesCompactProps {
  games: AggregatedProfile["topGames"];
  barClass: string;
}

export function TopGamesCompact({ games, barClass }: TopGamesCompactProps) {
  const top5 = games.slice(0, 5);
  const maxHours = top5[0]?.playtimeHours || 1;

  return (
    <div className="space-y-2">
      {top5.map((game) => {
        const pct = Math.round((game.playtimeHours / maxHours) * 100);
        return (
          <div key={game.appid} className="flex items-center gap-2">
            <span className="w-28 text-xs text-gray-400 truncate text-right">{game.name}</span>
            <div className="flex-1 bg-gray-800 rounded-full h-2 relative">
              <div
                className={`bg-gradient-to-r ${barClass} rounded-full h-2`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="flex items-center gap-1.5 w-24 justify-end">
              <span className="text-xs text-gray-500 font-mono">{game.playtimeHours}h</span>
              {game.vsAverage && (
                <span className={`text-[10px] font-mono ${game.vsAverage > 2 ? "text-red-400" : game.vsAverage > 1 ? "text-yellow-400" : "text-green-400"}`}>
                  {game.vsAverage}x
                </span>
              )}
              {game.isFree && (
                <span className="text-[9px] bg-green-900/50 text-green-400 px-1 rounded">F2P</span>
              )}
              {game.achievementRate !== undefined && (
                <span className="text-[10px] text-gray-600 font-mono">{game.achievementRate}%</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
