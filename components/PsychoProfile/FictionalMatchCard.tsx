"use client";

import type { PsychoProfile } from "@/lib/llm/types";

interface FictionalMatchCardProps {
  character: PsychoProfile["fictional_character"];
  i18n: {
    title: string;
    from: string;
    why: string;
  };
}

export function FictionalMatchCard({ character, i18n }: FictionalMatchCardProps) {
  return (
    <div className="relative rounded-2xl p-[1px] bg-gradient-to-r from-amber-500/50 via-orange-500/50 to-amber-500/50">
      <div className="rounded-2xl bg-gray-950 p-5">
        <h3 className="text-sm font-semibold text-amber-400 uppercase tracking-wider mb-3">
          🎭 {i18n.title}
        </h3>
        <div className="flex items-start gap-4">
          <span className="text-3xl">🎮</span>
          <div className="flex-1">
            <p className="text-lg font-bold text-white mb-1">{character.name}</p>
            <p className="text-sm text-gray-400">
              {i18n.from} <span className="text-amber-400 font-medium">{character.from}</span>
            </p>
            <p className="text-xs text-gray-500 mt-2 leading-relaxed">
              {i18n.why}: {character.reason}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
