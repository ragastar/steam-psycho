"use client";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
} from "recharts";

const RARITY_COLORS: Record<string, string> = {
  common: "#71717a",
  uncommon: "#22c55e",
  rare: "#3b82f6",
  epic: "#a855f7",
  legendary: "#f59e0b",
};

interface UsersChartsProps {
  rarity: { rarity: string; count: number }[];
  avgStats: { dedication: number; mastery: number; exploration: number; hoarding: number; social: number; veteran: number } | null;
  showRadar?: boolean;
}

export default function UsersCharts({ rarity, avgStats, showRadar }: UsersChartsProps) {
  if (showRadar && avgStats) {
    const radarData = [
      { stat: "Dedication", value: avgStats.dedication },
      { stat: "Mastery", value: avgStats.mastery },
      { stat: "Exploration", value: avgStats.exploration },
      { stat: "Hoarding", value: avgStats.hoarding },
      { stat: "Social", value: avgStats.social },
      { stat: "Veteran", value: avgStats.veteran },
    ];

    return (
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={radarData}>
            <PolarGrid stroke="#3f3f46" />
            <PolarAngleAxis dataKey="stat" tick={{ fontSize: 11, fill: "#a1a1aa" }} />
            <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
            <Radar dataKey="value" stroke="#a855f7" fill="#a855f7" fillOpacity={0.3} />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (rarity.length === 0) {
    return <p className="py-8 text-center text-sm text-zinc-600">Нет данных</p>;
  }

  const barData = rarity.map((r) => ({
    ...r,
    fill: RARITY_COLORS[r.rarity] || "#71717a",
  }));

  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={barData}>
          <XAxis dataKey="rarity" tick={{ fontSize: 11, fill: "#71717a" }} />
          <YAxis tick={{ fontSize: 11, fill: "#71717a" }} />
          <Tooltip
            contentStyle={{ backgroundColor: "#18181b", border: "1px solid #3f3f46", borderRadius: 8 }}
          />
          <Bar dataKey="count" name="Кол-во">
            {barData.map((entry, i) => (
              <Cell key={i} fill={entry.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
