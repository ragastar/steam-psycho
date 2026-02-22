"use client";

import type { PsychoProfile } from "@/lib/llm/types";

interface BigFiveChartProps {
  bigFive: PsychoProfile["big_five"];
  labels: PsychoProfile["big_five_labels"];
  i18n: {
    title: string;
    description: string;
    openness: string;
    conscientiousness: string;
    extraversion: string;
    agreeableness: string;
    neuroticism: string;
  };
}

const AXES: (keyof PsychoProfile["big_five"])[] = [
  "openness",
  "conscientiousness",
  "extraversion",
  "agreeableness",
  "neuroticism",
];

const COLORS: Record<string, string> = {
  openness: "from-cyan-400 to-blue-500",
  conscientiousness: "from-green-400 to-emerald-500",
  extraversion: "from-yellow-400 to-orange-500",
  agreeableness: "from-pink-400 to-rose-500",
  neuroticism: "from-purple-400 to-violet-500",
};

export function BigFiveChart({ bigFive, labels, i18n }: BigFiveChartProps) {
  // Pentagon SVG
  const cx = 100, cy = 100, r = 70;
  const angles = AXES.map((_, i) => (Math.PI * 2 * i) / 5 - Math.PI / 2);

  const gridLevels = [0.25, 0.5, 0.75, 1];
  const gridPolygons = gridLevels.map((level) =>
    angles.map((a) => `${cx + r * level * Math.cos(a)},${cy + r * level * Math.sin(a)}`).join(" ")
  );

  const values = AXES.map((key) => bigFive[key] / 100);
  const dataPoints = angles.map((a, i) => `${cx + r * values[i] * Math.cos(a)},${cy + r * values[i] * Math.sin(a)}`).join(" ");

  return (
    <div className="bg-gray-900 rounded-2xl p-5">
      <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-1">{i18n.title}</h3>
      <p className="text-xs text-gray-500 mb-4">{i18n.description}</p>

      {/* SVG Pentagon */}
      <div className="flex justify-center mb-5">
        <svg viewBox="0 0 200 200" className="w-56 h-56">
          {/* Grid */}
          {gridPolygons.map((points, i) => (
            <polygon key={i} points={points} fill="none" stroke="rgba(107,114,128,0.2)" strokeWidth="0.5" />
          ))}
          {/* Axes */}
          {angles.map((a, i) => (
            <line key={i} x1={cx} y1={cy} x2={cx + r * Math.cos(a)} y2={cy + r * Math.sin(a)} stroke="rgba(107,114,128,0.15)" strokeWidth="0.5" />
          ))}
          {/* Data */}
          <polygon points={dataPoints} fill="rgba(168,85,247,0.15)" stroke="rgba(168,85,247,0.8)" strokeWidth="1.5" />
          {/* Points */}
          {angles.map((a, i) => (
            <circle key={i} cx={cx + r * values[i] * Math.cos(a)} cy={cy + r * values[i] * Math.sin(a)} r="3" fill="#a855f7" />
          ))}
          {/* Labels */}
          {angles.map((a, i) => {
            const lx = cx + (r + 18) * Math.cos(a);
            const ly = cy + (r + 18) * Math.sin(a);
            return (
              <text key={i} x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" className="fill-gray-400 text-[7px]">
                {bigFive[AXES[i]]}
              </text>
            );
          })}
        </svg>
      </div>

      {/* Bars fallback */}
      <div className="space-y-3">
        {AXES.map((key) => (
          <div key={key}>
            <div className="flex justify-between items-baseline mb-1">
              <span className="text-xs text-gray-400">{i18n[key]}</span>
              <span className="text-xs text-gray-500 italic truncate ml-2 max-w-[50%] text-right">{labels[key]}</span>
            </div>
            <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full bg-gradient-to-r ${COLORS[key]} transition-all duration-700`}
                style={{ width: `${bigFive[key]}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
