"use client";

import type { SocialType } from "@/lib/llm/types";

interface SocialTypeCardProps {
  type: SocialType;
  description: string;
  label: string;
  typeLabel: string;
}

const TYPE_ICONS: Record<SocialType, string> = {
  lone_wolf: "🐺",
  pack_leader: "👑",
  silent_ally: "🤝",
  social_butterfly: "🦋",
  ghost: "👻",
};

export function SocialTypeCard({ type, description, label, typeLabel }: SocialTypeCardProps) {
  return (
    <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800/50">
      <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3">{label}</h3>
      <div className="flex items-center gap-3 mb-3">
        <span className="text-2xl">{TYPE_ICONS[type]}</span>
        <span className="text-lg font-bold text-white">{typeLabel}</span>
      </div>
      <p className="text-xs text-gray-400 leading-relaxed">{description}</p>
    </div>
  );
}
