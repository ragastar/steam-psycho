import type { CardPortrait } from "../llm/types";
import { PALETTE_HINTS, type Element, type Palette } from "./card-identity";

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

const RARITY_STYLE: Record<string, string> = {
  common: "clean matte frame, subtle card texture, standard collectible card",
  uncommon: "brushed metal frame with slight sheen, polished card surface",
  rare: "detailed engraved frame with metallic inlays, holographic subtle shimmer",
  epic: "elaborate ornamental frame with gemstone accents, foil-like reflective surface, dramatic backlighting",
  legendary: "extravagant golden frame with divine radiance, holographic prismatic surface, god-rays",
};

/**
 * Описание духа пишет модель. Карта из восемнадцати готовых существ, что стояла
 * здесь запасным вариантом, удалена: класс существа теперь задаёт код, а
 * конкретику всё равно придумывает модель — до запасного варианта дело не
 * доходило ни разу.
 */
function getCreatureDescription(portrait: CardPortrait): string {
  if (portrait.spirit_animal?.art_description) return portrait.spirit_animal.art_description;
  return `a mythical ${portrait.spirit_animal?.name || "creature"}, majestic and absurd`;
}

export function buildImagePrompt(
  portrait: CardPortrait,
  element: Element,
  palette: Palette,
): string {
  const frame = ELEMENT_FRAMES[element];
  const creatureDesc = getCreatureDescription(portrait);
  const creatureName = portrait.spirit_animal?.name || "phoenix";
  const rarityStyle = RARITY_STYLE[portrait.rarity] || RARITY_STYLE.common;

  console.log(`[art] дух: ${creatureName}, стихия: ${element}, свет: ${palette}, редкость: ${portrait.rarity}`);

  return [
    `A collectible trading card in the style of Magic: The Gathering.`,
    `The card features ${creatureDesc} as the central portrait, framed within a ${frame}.`,
    `Scene: ${portrait.art_scene}. Mood: ${portrait.art_mood}.`,
    `Card style: ${rarityStyle}.`,
    `Lighting and palette: ${PALETTE_HINTS[palette]}.`,
    `The creature is rendered in a painterly fantasy art style, rich colors, confident brushwork.`,
    `Portrait-oriented vertical card layout with thick decorative border surrounding the art panel.`,
    `No humans, no people, no gaming desk, no monitors — the creature is the only character.`,
    `No text, no numbers, no mana symbols, no titles — art only.`,
    `Vertical aspect ratio 3:5, photorealistic card render with soft shadow beneath.`,
  ].join(" ");
}
