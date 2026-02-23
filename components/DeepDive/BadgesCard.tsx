import type { AggregatedProfile } from "@/lib/aggregation/types";

interface BadgesCardProps {
  badges: AggregatedProfile["badges"];
  steamLevel: number;
  labels: {
    title: string;
    total: string;
    xp: string;
    level: string;
    rarest: string;
    rarestOwners: string;
    noData: string;
  };
}

export function BadgesCard({ badges, steamLevel, labels }: BadgesCardProps) {
  if (badges.totalCount === 0) {
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
      <div className="grid grid-cols-3 gap-3">
        <div className="text-center">
          <p className="text-xl font-bold font-mono text-white">{badges.totalCount}</p>
          <p className="text-[10px] text-gray-500">{labels.total}</p>
        </div>
        <div className="text-center">
          <p className="text-xl font-bold font-mono text-purple-400">{badges.totalXP.toLocaleString()}</p>
          <p className="text-[10px] text-gray-500">{labels.xp}</p>
        </div>
        <div className="text-center">
          <p className="text-xl font-bold font-mono text-cyan-400">{steamLevel}</p>
          <p className="text-[10px] text-gray-500">{labels.level}</p>
        </div>
      </div>
      {badges.rarestBadge && (
        <div className="mt-3 pt-3 border-t border-gray-800/50">
          <p className="text-xs text-gray-500">{labels.rarest}</p>
          <p className="text-sm text-yellow-400 font-medium">
            Badge #{badges.rarestBadge.badgeid}
            <span className="text-gray-500 text-xs ml-2">
              {badges.rarestBadge.scarcity.toLocaleString()} {labels.rarestOwners}
            </span>
          </p>
        </div>
      )}
    </div>
  );
}
