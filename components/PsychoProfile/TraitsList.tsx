"use client";

import type { PsychoProfile } from "@/lib/llm/types";

interface TraitsListProps {
  traits: PsychoProfile["traits"];
  label: string;
}

export function TraitsList({ traits, label }: TraitsListProps) {
  return (
    <div className="bg-gray-900 rounded-2xl p-5">
      <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">{label}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {traits.map((trait, i) => (
          <div key={i} className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/50">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">{trait.icon}</span>
              <span className="text-sm font-semibold text-white flex-1">{trait.name}</span>
              <span className="text-xs font-mono text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded-full">
                {trait.score}
              </span>
            </div>
            <p className="text-xs text-gray-400 leading-relaxed">{trait.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
