import type { AggregatedProfile } from "../aggregation/types";
import type { CardStats } from "../aggregation/aggregate";

export type Creature =
  | "phoenix" | "dragon" | "fox" | "wraith" | "owl" | "wolf"
  | "serpent" | "griffin" | "raven" | "bear" | "tiger" | "stag"
  | "kraken" | "chimera" | "sphinx" | "hydra" | "falcon" | "panther";

export type Element =
  | "fire" | "ice" | "shadow" | "nature" | "arcane"
  | "storm" | "void" | "iron" | "blood" | "crystal";

interface CardIdentity {
  creature: Creature;
  element: Element;
}

// --- Creature selection based on dominant stat + secondary ---

const STAT_CREATURES: Record<string, Creature[]> = {
  dedication: ["phoenix", "bear", "stag"],      // loyalty, endurance, persistence
  mastery: ["dragon", "tiger", "falcon"],        // power, precision, speed
  exploration: ["fox", "griffin", "chimera"],     // cunning, variety, hybrid
  hoarding: ["wraith", "serpent", "hydra"],       // collector, coiled, many-headed
  social: ["wolf", "kraken", "panther"],          // pack, reach, charisma
  veteran: ["owl", "sphinx", "raven"],            // wisdom, riddle, memory
};

// --- Element selection based on top genres/tags ---

const GENRE_ELEMENTS: [RegExp, Element][] = [
  [/shooter|fps|action/i, "fire"],
  [/strategy|tactical|tower defense|4x/i, "ice"],
  [/horror|stealth|noir|dark/i, "shadow"],
  [/rpg|survival|open world|adventure/i, "nature"],
  [/puzzle|indie|roguelike|platformer/i, "arcane"],
  [/racing|sports|fighting/i, "storm"],
  [/space|sci-fi|cyberpunk/i, "void"],
  [/simulation|management|building/i, "iron"],
  [/souls-like|difficult|hardcore/i, "blood"],
  [/relaxing|casual|visual novel|anime/i, "crystal"],
];

export function selectCardIdentity(
  profile: AggregatedProfile,
  cardStats: CardStats,
): CardIdentity {
  // --- Select creature ---
  const stats: [string, number][] = [
    ["dedication", cardStats.dedication],
    ["mastery", cardStats.mastery],
    ["exploration", cardStats.exploration],
    ["hoarding", cardStats.hoarding],
    ["social", cardStats.social],
    ["veteran", cardStats.veteran],
  ];
  stats.sort((a, b) => b[1] - a[1]);

  const primaryStat = stats[0][0];
  const secondaryStat = stats[1][0];
  const primaryCreatures = STAT_CREATURES[primaryStat];
  const secondaryCreatures = STAT_CREATURES[secondaryStat];

  // Use combination of primary stat value + secondary to pick variant
  // This gives 3 creatures per stat × 6 stats = 18 unique creatures
  const primaryValue = stats[0][1];
  const secondaryValue = stats[1][1];
  const spread = primaryValue - secondaryValue;

  let creature: Creature;
  if (spread > 20) {
    // Dominant stat — pick iconic creature (index 0)
    creature = primaryCreatures[0];
  } else if (spread > 8) {
    // Moderate dominance — pick secondary variant
    creature = primaryCreatures[1];
  } else {
    // Stats are close — pick hybrid from secondary stat
    creature = secondaryCreatures[2] || primaryCreatures[2];
  }

  // --- Select element ---
  // Build a string of all top genres + tags for matching
  const genreStr = profile.genreDistribution
    .slice(0, 5)
    .map((g) => g.genre)
    .join(" ");
  const tagStr = profile.tagDistribution
    .slice(0, 10)
    .map((t) => t.tag)
    .join(" ");
  const combined = `${genreStr} ${tagStr}`;

  // Score each element
  const elementScores = new Map<Element, number>();
  GENRE_ELEMENTS.forEach(([pattern, el]) => {
    const matches = combined.match(new RegExp(pattern, "gi"));
    if (matches) {
      elementScores.set(el, (elementScores.get(el) || 0) + matches.length);
    }
  });

  let element: Element = "arcane"; // default
  let maxScore = 0;
  elementScores.forEach((score, el) => {
    if (score > maxScore) {
      maxScore = score;
      element = el;
    }
  });

  console.log(`[card-identity] Stats: ${stats.map(([k, v]) => `${k}=${v}`).join(", ")}`);
  console.log(`[card-identity] Creature: ${creature} (${primaryStat}→${secondaryStat}, spread=${spread})`);
  console.log(`[card-identity] Element: ${element} (genres: ${genreStr})`);

  return { creature, element };
}
