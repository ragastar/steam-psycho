"use client";

import { useState } from "react";
import { motion } from "framer-motion";

interface StatItem {
  key: string;
  label: string;
  value: number;
  explanation?: string;
}

interface StatsGridProps {
  stats: StatItem[];
  barClass: string;
  gradientClass: string;
}

export function StatsGrid({ stats, barClass, gradientClass }: StatsGridProps) {
  const [showExplanations, setShowExplanations] = useState(false);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-xs text-gray-500 uppercase tracking-wider">Stats</h3>
        <button
          onClick={() => setShowExplanations(!showExplanations)}
          className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
        >
          {showExplanations ? "×" : "?"}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        {stats.map((stat, i) => (
          <div key={stat.key}>
            <div className="flex justify-between text-xs mb-0.5">
              <span className="text-gray-400">{stat.label}</span>
              <span className={`font-mono font-bold bg-gradient-to-r ${gradientClass} bg-clip-text text-transparent`}>
                {stat.value}
              </span>
            </div>
            <div className="w-full bg-gray-800 rounded-full h-2">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${stat.value}%` }}
                transition={{ duration: 0.8, delay: i * 0.1, ease: "easeOut" }}
                className={`bg-gradient-to-r ${barClass} rounded-full h-2`}
              />
            </div>
            {showExplanations && stat.explanation && (
              <p className="text-[10px] text-gray-600 mt-0.5">{stat.explanation}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
