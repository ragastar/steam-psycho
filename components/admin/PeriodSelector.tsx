"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { clsx } from "clsx";

const PERIODS = [
  { label: "7д", value: "7" },
  { label: "30д", value: "30" },
  { label: "90д", value: "90" },
];

export default function PeriodSelector() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const current = searchParams.get("days") || "30";

  return (
    <div className="flex gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-1">
      {PERIODS.map((p) => (
        <button
          key={p.value}
          onClick={() => router.push(`?days=${p.value}`)}
          className={clsx(
            "rounded-md px-3 py-1 text-xs transition-colors",
            current === p.value ? "bg-purple-600 text-white" : "text-zinc-400 hover:text-white",
          )}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
