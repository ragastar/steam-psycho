import { describe, it, expect } from "vitest";
import { applyComputedFacts } from "@/lib/llm/facts";
import type { CardPortrait } from "@/lib/llm/types";
import type { CardStats } from "@/lib/aggregation/aggregate";

const computed: CardStats = {
  dedication: 84,
  mastery: 61,
  exploration: 42,
  hoarding: 77,
  social: 30,
  veteran: 90,
};

// Модель вернула свои числа вместо тех, что ей дали.
const portrait = {
  primaryArchetype: { name: "Тест", description: "…", color: "#fff" },
  stats: { dedication: 71, mastery: 12, exploration: 99, hoarding: 3, social: 55, veteran: 8 },
  rarity: "common",
  quote: "…",
} as unknown as CardPortrait;

describe("applyComputedFacts (DATA-4)", () => {
  it("заменяет статы модели на посчитанные", () => {
    const fixed = applyComputedFacts(portrait, computed, "legendary");
    expect(fixed.stats).toEqual(computed);
  });

  it("заменяет редкость на посчитанную", () => {
    const fixed = applyComputedFacts(portrait, computed, "legendary");
    expect(fixed.rarity).toBe("legendary");
  });

  it("не трогает текстовую часть портрета", () => {
    const fixed = applyComputedFacts(portrait, computed, "legendary");
    expect(fixed.primaryArchetype).toEqual(portrait.primaryArchetype);
    expect(fixed.quote).toBe(portrait.quote);
  });

  it("не мутирует исходный объект", () => {
    applyComputedFacts(portrait, computed, "legendary");
    expect(portrait.stats.dedication).toBe(71);
  });
});
