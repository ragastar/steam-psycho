import { z } from "zod";

export const RarityEnum = z.enum(["common", "uncommon", "rare", "epic", "legendary"]);
export type Rarity = z.infer<typeof RarityEnum>;

// Element and Creature are now selected algorithmically in lib/art/card-identity.ts
// Kept for backwards compatibility with cached portraits
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
  art_description: z.string().optional(),
});

export const DecisionStyleEnum = z.enum(["methodical", "impulsive", "completionist", "optimizer", "explorer"]);
export type DecisionStyle = z.infer<typeof DecisionStyleEnum>;

export const SocialTypeEnum = z.enum(["lone_wolf", "pack_leader", "silent_ally", "social_butterfly", "ghost"]);
export type SocialType = z.infer<typeof SocialTypeEnum>;

export const BigFiveSchema = z.object({
  openness: z.number().min(0).max(100),
  conscientiousness: z.number().min(0).max(100),
  extraversion: z.number().min(0).max(100),
  agreeableness: z.number().min(0).max(100),
  neuroticism: z.number().min(0).max(100),
});

export const BigFiveLabelsSchema = z.object({
  openness: z.string(),
  conscientiousness: z.string(),
  extraversion: z.string(),
  agreeableness: z.string(),
  neuroticism: z.string(),
});

export const MotivationsSchema = z.object({
  achievement: z.number().min(0).max(100),
  immersion: z.number().min(0).max(100),
  social: z.number().min(0).max(100),
  mastery: z.number().min(0).max(100),
  escapism: z.number().min(0).max(100),
  curiosity: z.number().min(0).max(100),
});

export const PsychoTraitSchema = z.object({
  name: z.string(),
  score: z.number().min(0).max(100),
  description: z.string(),
  icon: z.string(),
});

export const FictionalCharacterSchema = z.object({
  name: z.string(),
  from: z.string(),
  reason: z.string(),
});

export const PsychoProfileSchema = z.object({
  big_five: BigFiveSchema,
  big_five_labels: BigFiveLabelsSchema,
  motivations: MotivationsSchema,
  traits: z.array(PsychoTraitSchema).min(4).max(5),
  decision_style: DecisionStyleEnum,
  decision_style_description: z.string(),
  social_type: SocialTypeEnum,
  social_type_description: z.string(),
  psych_summary: z.string(),
  fictional_character: FictionalCharacterSchema,
});

export type PsychoProfile = z.infer<typeof PsychoProfileSchema>;

export const CardPortraitSchema = z.object({
  primaryArchetype: ArchetypeSchema,
  secondaryArchetype: ArchetypeSchema,
  shadowArchetype: ArchetypeSchema,
  title: z.string(),
  emoji: z.string(),
  rarity: RarityEnum,
  element: ElementEnum.optional(),
  creature: z.string().optional(),
  stats: CardStatsSchema,
  roasts: z.array(RoastSchema).min(5).max(6),
  spirit_game: z.string(),
  spirit_animal: SpiritAnimalSchema,
  lore: z.string(),
  quote: z.string(),
  art_mood: z.string(),
  art_scene: z.string(),
  psycho_profile: PsychoProfileSchema.optional(),
});

export type CardPortrait = z.infer<typeof CardPortraitSchema>;
export type Roast = z.infer<typeof RoastSchema>;
export type Archetype = z.infer<typeof ArchetypeSchema>;
