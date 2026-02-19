import { z } from "zod";

export const TraitSchema = z.object({
  name: z.string(),
  score: z.number().min(0).max(100),
  description: z.string(),
});

export const PortraitSchema = z.object({
  archetype: z.string(),
  archetypeEmoji: z.string(),
  shortBio: z.string(),
  traits: z.array(TraitSchema).min(3).max(5),
  deepDive: z.string(),
  spiritGame: z.object({
    name: z.string(),
    reason: z.string(),
  }),
  funFacts: z.array(z.string()).min(2).max(4),
  toxicTrait: z.string(),
  recommendation: z.string(),
});

export type Portrait = z.infer<typeof PortraitSchema>;
export type Trait = z.infer<typeof TraitSchema>;
