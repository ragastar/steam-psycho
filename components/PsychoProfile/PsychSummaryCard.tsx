"use client";

interface PsychSummaryCardProps {
  summary: string;
  label: string;
}

export function PsychSummaryCard({ summary, label }: PsychSummaryCardProps) {
  return (
    <div className="relative rounded-2xl p-[1px] bg-gradient-to-r from-purple-500 via-pink-500 to-purple-500">
      <div className="rounded-2xl bg-gray-950 p-5">
        <h3 className="text-sm font-semibold text-purple-400 uppercase tracking-wider mb-3">
          🧠 {label}
        </h3>
        <p className="text-gray-200 leading-relaxed text-sm">{summary}</p>
      </div>
    </div>
  );
}
