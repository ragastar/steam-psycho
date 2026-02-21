import type { AggregatedProfile } from "@/lib/aggregation/types";

interface BadgesCardProps {
  badges: AggregatedProfile["badges"];
  labels: { title: string; total: string; xp: string; rarest: string; noData: string };
}

export function BadgesCard({ badges, labels }: BadgesCardProps) {
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
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-gray-500">{labels.total}</p>
          <p className="text-lg font-bold font-mono text-white">{badges.totalCount}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">{labels.xp}</p>
          <p className="text-lg font-bold font-mono text-white">{badges.totalXP.toLocaleString()}</p>
        </div>
        {badges.rarestBadge && (
          <div className="col-span-2">
            <p className="text-xs text-gray-500">{labels.rarest}</p>
            <p className="text-sm text-yellow-400 font-mono">
              Badge #{badges.rarestBadge.badgeid} — {badges.rarestBadge.scarcity.toLocaleString()} owners
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
