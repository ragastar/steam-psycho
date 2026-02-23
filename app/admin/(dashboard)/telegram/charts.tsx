"use client";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";

const EVENT_COLORS: Record<string, string> = {
  created: "#3b82f6",
  unlocked: "#22c55e",
  not_subscribed: "#ef4444",
};

const EVENT_LABELS: Record<string, string> = {
  created: "Created",
  unlocked: "Unlocked",
  not_subscribed: "Not subscribed",
};

interface TelegramChartsProps {
  funnel: { event: string; count: number }[];
}

export default function TelegramCharts({ funnel }: TelegramChartsProps) {
  const data = funnel.map((f) => ({
    name: EVENT_LABELS[f.event] || f.event,
    count: f.count,
    fill: EVENT_COLORS[f.event] || "#71717a",
  }));

  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-zinc-600">Нет данных</p>;
  }

  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical">
          <XAxis type="number" tick={{ fontSize: 11, fill: "#71717a" }} />
          <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: "#a1a1aa" }} width={120} />
          <Tooltip
            contentStyle={{ backgroundColor: "#18181b", border: "1px solid #3f3f46", borderRadius: 8 }}
          />
          <Bar dataKey="count" name="Кол-во">
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
