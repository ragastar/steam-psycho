import type { CardPortrait } from "../llm/types";

const ELEMENT_STYLES: Record<string, string> = {
  fire: "warm orange and red lighting, flames and embers",
  ice: "cool blue and white lighting, frost and crystals",
  shadow: "dark purple and black tones, mysterious shadows",
  nature: "lush green and earth tones, organic growth",
  arcane: "glowing violet and cyan, magical particles",
};

const CREATURE_DESCRIPTIONS: Record<string, string> = {
  phoenix: "a majestic phoenix with spread wings",
  dragon: "a powerful dragon with glowing eyes",
  fox: "a cunning nine-tailed fox",
  wraith: "a spectral wraith with flowing cloak",
  owl: "a wise owl with piercing gaze",
  wolf: "a noble wolf howling",
};

const RARITY_QUALITY: Record<string, string> = {
  common: "simple digital art style",
  uncommon: "polished digital illustration",
  rare: "detailed fantasy artwork",
  epic: "stunning high-detail fantasy painting",
  legendary: "masterwork epic fantasy painting, golden accents, divine light",
};

export function buildImagePrompt(portrait: CardPortrait): string {
  const element = ELEMENT_STYLES[portrait.element] || ELEMENT_STYLES.arcane;
  const creature = CREATURE_DESCRIPTIONS[portrait.creature] || CREATURE_DESCRIPTIONS.owl;
  const quality = RARITY_QUALITY[portrait.rarity] || RARITY_QUALITY.common;

  return `Gaming-themed collectible card art: ${creature} in a ${portrait.art_scene}. ${element}. Mood: ${portrait.art_mood}. Style: ${quality}. Aspect ratio 5:3, no text, no borders, vibrant colors, centered composition.`;
}
