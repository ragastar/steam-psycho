"use client";

import { useState } from "react";

interface PromptDisplayProps {
  prompt: string;
  labels: { title: string; copy: string; copied: string };
}

export function PromptDisplay({ prompt, labels }: PromptDisplayProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <div className="bg-gray-900/50 rounded-xl p-4 border border-gray-800">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-300">{labels.title}</h3>
        <button
          onClick={handleCopy}
          className="text-xs text-gray-500 hover:text-gray-300 transition-colors px-2 py-1 rounded bg-gray-800"
        >
          {copied ? labels.copied : labels.copy}
        </button>
      </div>
      <p className="text-xs text-gray-400 font-mono leading-relaxed bg-gray-950 rounded-lg p-3">
        {prompt}
      </p>
    </div>
  );
}
