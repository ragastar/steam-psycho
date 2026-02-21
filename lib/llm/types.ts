import { z } from "zod";

export const RarityEnum = z.enum(["common", "uncommon", "rare", "epic", "legendary"]);
export type Rarity = z.infer<typeof RarityEnum>;

export const ElementEnum = z.enum(["fire", "ice", "shadow", "nature", "arcane"]);
export type Element = z.infer<typeof ElementEnum>;

export const CreatureEnum = z.enum(["phoenix", "dragon", "fox", "wraith", "owl", "wolf"]);
export type Creature = z.infer<typeof CreatureEnum>;

export const SeverityEnum = z.enum(["critical", "legendary", "epic", "rare"]);
export type Severity = z.infer<typeof SeverityEnum>;

export const ArchetypeSchema = z.object({
  name: z.string(),
  description: z.string(),
  color: z.string(),
});

export const RoastSchema = z.object({
  icon: z.string(),
  title: z.string(),
  text: z.string(),
  stat: z.string(),
  severity: SeverityEnum,
  source: z.string(),
});

export const CardStatsSchema = z.object({
  dedication: z.number().min(0).max(100),
  mastery: z.number().min(0).max(100),
  exploration: z.number().min(0).max(100),
  hoarding: z.number().min(0).max(100),
  social: z.number().min(0).max(100),
  veteran: z.number().min(0).max(100),
});

export type CardStats = z.infer<typeof CardStatsSchema>;

export const SpiritAnimalSchema = z.object({
  name: z.string(),
  description: z.string(),
});

export const CardPortraitSchema = z.object({
  primaryArchetype: ArchetypeSchema,
  secondaryArchetype: ArchetypeSchema,
  shadowArchetype: ArchetypeSchema,
  title: z.string(),
  emoji: z.string(),
  rarity: RarityEnum,
  element: ElementEnum,
  creature: CreatureEnum,
  stats: CardStatsSchema,
  roasts: z.array(RoastSchema).min(5).max(6),
  spirit_game: z.string(),
  spirit_animal: SpiritAnimalSchema,
  lore: z.string(),
  quote: z.string(),
  art_mood: z.string(),
  art_scene: z.string(),
});

export type CardPortrait = z.infer<typeof CardPortraitSchema>;
export type Roast = z.infer<typeof RoastSchema>;
export type Archetype = z.infer<typeof ArchetypeSchema>;
