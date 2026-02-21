import type { AggregatedProfile } from "@/lib/aggregation/types";

interface PlatformsBarProps {
  platforms: AggregatedProfile["platforms"];
  labels: { title: string; windows: string; linux: string; deck: string };
}

export function PlatformsBar({ platforms, labels }: PlatformsBarProps) {
  const segments = [
    { label: labels.windows, pct: platforms.windowsPercentage, color: "bg-blue-500" },
    { label: labels.linux, pct: platforms.linuxPercentage, color: "bg-orange-500" },
    { label: labels.deck, pct: platforms.deckPercentage, color: "bg-green-500" },
  ].filter((s) => s.pct > 0);

  return (
    <div className="bg-gray-900/50 rounded-xl p-4 border border-gray-800">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">{labels.title}</h3>
      <div className="w-full h-4 bg-gray-800 rounded-full overflow-hidden flex">
        {segments.map((seg) => (
          <div
            key={seg.label}
            className={`${seg.color} h-full transition-all`}
            style={{ width: `${seg.pct}%` }}
          />
        ))}
      </div>
      <div className="flex gap-4 mt-2">
        {segments.map((seg) => (
          <div key={seg.label} className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${seg.color}`} />
            <span className="text-xs text-gray-400">{seg.label}</span>
            <span className="text-xs text-gray-500 font-mono">{seg.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
