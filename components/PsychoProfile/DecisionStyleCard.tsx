"use client";

import type { DecisionStyle } from "@/lib/llm/types";

interface DecisionStyleCardProps {
  style: DecisionStyle;
  description: string;
  label: string;
  styleLabel: string;
}

const STYLE_ICONS: Record<DecisionStyle, string> = {
  methodical: "🎯",
  impulsive: "⚡",
  completionist: "✅",
  optimizer: "📊",
  explorer: "🧭",
};

export function DecisionStyleCard({ style, description, label, styleLabel }: DecisionStyleCardProps) {
  return (
    <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800/50">
      <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3">{label}</h3>
      <div className="flex items-center gap-3 mb-3">
        <span className="text-2xl">{STYLE_ICONS[style]}</span>
        <span className="text-lg font-bold text-white">{styleLabel}</span>
      </div>
      <p className="text-xs text-gray-400 leading-relaxed">{description}</p>
    </div>
  );
}
