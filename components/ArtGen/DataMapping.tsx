import type { CardPortrait } from "@/lib/llm/types";

interface DataMappingProps {
  portrait: CardPortrait;
  labels: {
    title: string;
    element: string;
    creature: string;
    mood: string;
    scene: string;
  };
}

export function DataMapping({ portrait, labels }: DataMappingProps) {
  const items = [
    portrait.element ? { label: labels.element, value: portrait.element, icon: getElementIcon(portrait.element) } : null,
    portrait.spirit_animal?.name ? { label: labels.creature, value: portrait.spirit_animal.name, icon: getCreatureIcon(portrait.spirit_animal.name) } : null,
    { label: labels.mood, value: portrait.art_mood },
    { label: labels.scene, value: portrait.art_scene },
  ].filter(Boolean) as { label: string; value: string; icon?: string }[];

  return (
    <div className="bg-gray-900/50 rounded-xl p-4 border border-gray-800">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">{labels.title}</h3>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.label} className="flex items-start gap-2">
            <span className="text-xs text-gray-500 w-20 flex-shrink-0 pt-0.5">{item.label}</span>
            <span className="text-sm text-gray-300">
              {item.icon && <span className="mr-1">{item.icon}</span>}
              {item.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function getElementIcon(element: string): string {
  const map: Record<string, string> = {
    fire: "🔥", ice: "❄️", shadow: "🌑", nature: "🌿", arcane: "✨",
    storm: "⚡", void: "🕳️", iron: "⚔️", blood: "🩸", crystal: "💎",
  };
  return map[element] || "✨";
}

function getCreatureIcon(creature: string): string {
  const map: Record<string, string> = {
    phoenix: "🐦‍🔥", dragon: "🐉", fox: "🦊", wraith: "👻", owl: "🦉", wolf: "🐺",
    serpent: "🐍", griffin: "🦅", raven: "🪶", bear: "🐻", tiger: "🐯", stag: "🦌",
    kraken: "🐙", chimera: "🦁", sphinx: "🗿", hydra: "🐲", falcon: "🦅", panther: "🐆",
  };
  return map[creature] || "🐾";
}
