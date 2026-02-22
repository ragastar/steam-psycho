"use client";

import type { Roast, Severity } from "@/lib/llm/types";

const SEVERITY_STYLES: Record<Severity, { border: string; bg: string; text: string }> = {
  critical: { border: "border-l-red-500", bg: "bg-red-950/30", text: "text-red-400" },
  legendary: { border: "border-l-yellow-500", bg: "bg-yellow-950/30", text: "text-yellow-400" },
  epic: { border: "border-l-purple-500", bg: "bg-purple-950/30", text: "text-purple-400" },
  rare: { border: "border-l-blue-500", bg: "bg-blue-950/30", text: "text-blue-400" },
};

interface RoastsListProps {
  roasts: Roast[];
}

export function RoastsList({ roasts }: RoastsListProps) {
  return (
    <div className="space-y-2">
      {roasts.map((roast, i) => {
        const style = SEVERITY_STYLES[roast.severity] || SEVERITY_STYLES.rare;
        return (
          <div
            key={i}
            className={`flex items-start gap-3 ${style.bg} rounded-lg p-3 border-l-4 ${style.border}`}
          >
            <span className="text-xl flex-shrink-0">{roast.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-sm font-semibold text-gray-200">{roast.title}</span>
                <span className={`text-[10px] uppercase tracking-wider font-mono ${style.text}`}>
                  {roast.severity}
                </span>
              </div>
              <p className="text-gray-300 text-sm leading-relaxed">{roast.text}</p>
              <div className="flex items-center gap-3 mt-1.5">
                <span className={`text-xs font-mono font-semibold ${style.text}`}>{roast.stat}</span>
                {roast.source && (
                  <span className="text-[11px] text-gray-500">{roast.source}</span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
