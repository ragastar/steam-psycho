"use client";

import type { PsychoProfile } from "@/lib/llm/types";

interface MotivationBarsProps {
  motivations: PsychoProfile["motivations"];
  i18n: {
    title: string;
    description: string;
    achievement: string;
    immersion: string;
    social: string;
    mastery: string;
    escapism: string;
    curiosity: string;
  };
}

const MOTIVATION_KEYS: { key: keyof PsychoProfile["motivations"]; icon: string; color: string }[] = [
  { key: "achievement", icon: "🏆", color: "from-yellow-400 to-amber-500" },
  { key: "immersion", icon: "🌊", color: "from-blue-400 to-indigo-500" },
  { key: "social", icon: "👥", color: "from-green-400 to-emerald-500" },
  { key: "mastery", icon: "⚔️", color: "from-red-400 to-rose-500" },
  { key: "escapism", icon: "🚀", color: "from-purple-400 to-violet-500" },
  { key: "curiosity", icon: "🔮", color: "from-cyan-400 to-teal-500" },
];

export function MotivationBars({ motivations, i18n }: MotivationBarsProps) {
  const labelMap: Record<string, string> = {
    achievement: i18n.achievement,
    immersion: i18n.immersion,
    social: i18n.social,
    mastery: i18n.mastery,
    escapism: i18n.escapism,
    curiosity: i18n.curiosity,
  };

  return (
    <div className="bg-gray-900 rounded-2xl p-5">
      <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-1">{i18n.title}</h3>
      <p className="text-xs text-gray-500 mb-4">{i18n.description}</p>

      <div className="space-y-3">
        {MOTIVATION_KEYS.map(({ key, icon, color }) => (
          <div key={key}>
            <div className="flex justify-between items-center mb-1">
              <span className="text-xs text-gray-400">
                {icon} {labelMap[key]}
              </span>
              <span className="text-xs font-mono text-gray-500">{motivations[key]}</span>
            </div>
            <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full bg-gradient-to-r ${color} transition-all duration-700`}
                style={{ width: `${motivations[key]}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
