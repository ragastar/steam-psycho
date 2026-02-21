import type { Archetype } from "@/lib/llm/types";

interface ArchetypeBadgesProps {
  primary: Archetype;
  secondary: Archetype;
  shadow: Archetype;
  labels: { primary: string; secondary: string; shadow: string };
}

export function ArchetypeBadges({ primary, secondary, shadow, labels }: ArchetypeBadgesProps) {
  const archetypes = [
    { data: primary, label: labels.primary, opacity: "opacity-100" },
    { data: secondary, label: labels.secondary, opacity: "opacity-80" },
    { data: shadow, label: labels.shadow, opacity: "opacity-60" },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {archetypes.map(({ data, label, opacity }) => (
        <div
          key={label}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs ${opacity}`}
          style={{
            borderColor: data.color,
            backgroundColor: `${data.color}15`,
            color: data.color,
          }}
        >
          <span className="text-[10px] uppercase tracking-wider text-gray-500">{label}</span>
          <span className="font-semibold">{data.name}</span>
        </div>
      ))}
    </div>
  );
}
