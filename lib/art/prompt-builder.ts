import type { CardPortrait } from "../llm/types";
import type { Creature, Element } from "./card-identity";

const ELEMENT_FRAMES: Record<Element, string> = {
  fire: "ornate bronze and crimson metal frame with ember particles, molten cracks glowing orange",
  ice: "frosted silver frame with ice crystal formations, pale blue frost patterns along edges",
  shadow: "dark obsidian frame with purple ethereal wisps, shadowy tendrils wrapping the border",
  nature: "ancient wooden frame with living vines and moss, small glowing flowers on the border",
  arcane: "runic stone frame with glowing cyan sigils, arcane energy pulsing through channels",
  storm: "crackling electrified titanium frame, lightning arcs jumping between contact points",
  void: "sleek black chrome frame with starfield reflections, deep space nebula glow at edges",
  iron: "heavy industrial riveted steel frame, brass gears and pipes integrated into borders",
  blood: "dark bone-and-sinew frame with crimson veins, thorns and pulsing red crystalline inlays",
  crystal: "translucent prismatic crystal frame, refracting rainbow light, ethereal and delicate",
};

const CREATURE_DESCRIPTIONS: Record<Creature, string> = {
  phoenix: "a majestic phoenix with spread wings, feathers trailing fire and golden light",
  dragon: "a powerful dragon with glowing eyes and armored scales, radiating dominance",
  fox: "a cunning nine-tailed spirit fox, tails flowing with mystical energy",
  wraith: "a spectral wraith with flowing tattered cloak, ethereal and ominous",
  owl: "a wise great owl with piercing luminous eyes, perched with ancient authority",
  wolf: "a noble alpha wolf mid-howl, fur rippling with elemental power",
  serpent: "a colossal feathered serpent coiled around treasures, scales shimmering with runes",
  griffin: "a majestic griffin with eagle head and lion body, wings spread in flight",
  raven: "an ancient three-eyed raven wreathed in shadow smoke, all-seeing gaze",
  bear: "an armored war bear standing tall, scarred and battle-worn, indomitable presence",
  tiger: "a spectral white tiger mid-leap, stripes glowing with inner energy, razor precision",
  stag: "a celestial stag with crystalline antlers branching like a constellation, serene and eternal",
  kraken: "a vast kraken emerging from depths, tentacles reaching outward, bioluminescent patterns",
  chimera: "a three-headed chimera — lion, goat, serpent — each wreathed in different elemental energy",
  sphinx: "an ancient sphinx with human face and lion body, riddling gaze, surrounded by floating glyphs",
  hydra: "a many-headed hydra with each head a different color, regenerating and unstoppable",
  falcon: "a divine falcon diving at terminal velocity, wings folded, trailing a sonic shockwave",
  panther: "a shadow panther with void-black fur, eyes like twin stars, prowling with lethal grace",
};

const RARITY_STYLE: Record<string, string> = {
  common: "clean matte frame, subtle card texture, standard collectible card",
  uncommon: "brushed metal frame with slight sheen, polished card surface",
  rare: "detailed engraved frame with metallic inlays, holographic subtle shimmer",
  epic: "elaborate ornamental frame with gemstone accents, foil-like reflective surface, dramatic backlighting",
  legendary: "extravagant golden frame with divine radiance, holographic prismatic surface, god-rays",
};

export function buildImagePrompt(
  portrait: CardPortrait,
  creature: Creature,
  element: Element,
): string {
  const frame = ELEMENT_FRAMES[element];
  const creatureDesc = CREATURE_DESCRIPTIONS[creature];
  const rarityStyle = RARITY_STYLE[portrait.rarity] || RARITY_STYLE.common;

  console.log(`[art] Creature: ${creature}, Element: ${element}, Rarity: ${portrait.rarity}`);

  return [
    `A collectible trading card in the style of Magic: The Gathering.`,
    `The card features ${creatureDesc} as the central portrait, framed within a ${frame}.`,
    `Scene: ${portrait.art_scene}. Mood: ${portrait.art_mood}.`,
    `Card style: ${rarityStyle}.`,
    `The creature is rendered in a painterly fantasy art style, dramatic lighting, rich colors and deep shadows.`,
    `Portrait-oriented vertical card layout with thick decorative border surrounding the art panel.`,
    `Dark moody background behind the card. No text, no numbers, no mana symbols, no titles — art only.`,
    `Vertical aspect ratio 3:5, photorealistic card render with soft shadow beneath.`,
  ].join(" ");
}
