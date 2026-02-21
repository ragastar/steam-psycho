import type { AggregatedProfile } from "@/lib/aggregation/types";

interface TimelineCardProps {
  timeline: AggregatedProfile["timeline"];
  labels: {
    title: string;
    accountAge: string;
    currentMonthly: string;
    trend: string;
    lastActive: string;
    years: string;
    hours: string;
    trendRising: string;
    trendStable: string;
    trendDeclining: string;
    trendInactive: string;
  };
}

const TREND_STYLES: Record<string, { icon: string; color: string }> = {
  rising: { icon: "📈", color: "text-green-400" },
  stable: { icon: "📊", color: "text-blue-400" },
  declining: { icon: "📉", color: "text-yellow-400" },
  inactive: { icon: "💤", color: "text-gray-500" },
};

export function TimelineCard({ timeline, labels }: TimelineCardProps) {
  const trendStyle = TREND_STYLES[timeline.trend] || TREND_STYLES.stable;
  const trendLabel = {
    rising: labels.trendRising,
    stable: labels.trendStable,
    declining: labels.trendDeclining,
    inactive: labels.trendInactive,
  }[timeline.trend];

  return (
    <div className="bg-gray-900/50 rounded-xl p-4 border border-gray-800">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">{labels.title}</h3>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-gray-500">{labels.accountAge}</p>
          <p className="text-lg font-bold font-mono text-white">
            {timeline.accountAge} <span className="text-xs text-gray-500">{labels.years}</span>
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500">{labels.currentMonthly}</p>
          <p className="text-lg font-bold font-mono text-white">
            {timeline.currentMonthlyHours} <span className="text-xs text-gray-500">{labels.hours}</span>
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500">{labels.trend}</p>
          <p className={`text-sm font-semibold ${trendStyle.color}`}>
            {trendStyle.icon} {trendLabel}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500">{labels.lastActive}</p>
          <p className="text-sm text-gray-300 font-mono">{timeline.lastActivityDate || "—"}</p>
        </div>
      </div>
    </div>
  );
}
