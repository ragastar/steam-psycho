"use client";

import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";

const COLORS = ["#a855f7", "#3b82f6", "#10b981", "#f59e0b", "#ef4444"];

interface TrafficChartsProps {
  byDay: { day: string; count: number; cached: number; fresh: number }[];
  localeData: { name: string; value: number }[];
  cacheData: { name: string; value: number }[];
}

export default function TrafficCharts({ byDay, localeData, cacheData }: TrafficChartsProps) {
  return (
    <div className="space-y-8">
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={byDay}>
            <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#71717a" }} />
            <YAxis tick={{ fontSize: 11, fill: "#71717a" }} />
            <Tooltip
              contentStyle={{ backgroundColor: "#18181b", border: "1px solid #3f3f46", borderRadius: 8 }}
              labelStyle={{ color: "#a1a1aa" }}
            />
            <Line type="monotone" dataKey="fresh" stroke="#a855f7" name="Fresh" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="cached" stroke="#3b82f6" name="Cached" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="mb-2 text-xs text-zinc-500">Локали</p>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={localeData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label>
                  {localeData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Legend />
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs text-zinc-500">Cache hit/miss</p>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={cacheData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label>
                  {cacheData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Legend />
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
