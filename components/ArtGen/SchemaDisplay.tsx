"use client";

import { useState } from "react";
import type { CardPortrait } from "@/lib/llm/types";

interface SchemaDisplayProps {
  portrait: CardPortrait;
  labels: { title: string; expand: string; collapse: string };
}

export function SchemaDisplay({ portrait, labels }: SchemaDisplayProps) {
  const [expanded, setExpanded] = useState(false);

  const json = JSON.stringify(portrait, null, 2);
  const preview = json.slice(0, 300) + (json.length > 300 ? "..." : "");

  return (
    <div className="bg-gray-900/50 rounded-xl p-4 border border-gray-800">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-300">{labels.title}</h3>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          {expanded ? labels.collapse : labels.expand}
        </button>
      </div>
      <pre className="text-[10px] text-gray-400 font-mono leading-relaxed bg-gray-950 rounded-lg p-3 overflow-x-auto max-h-96 overflow-y-auto">
        {expanded ? json : preview}
      </pre>
    </div>
  );
}
