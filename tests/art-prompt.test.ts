import { describe, it, expect } from "vitest";
import { buildImagePrompt } from "@/lib/art/prompt-builder";
import type { CardPortrait } from "@/lib/llm/types";

const portrait = {
  rarity: "rare",
  art_scene: "A Dota lane at the moment the towers fall",
  art_mood: "triumphant exhaustion",
  spirit_animal: {
    name: "Осьминог-микроменеджер",
    description: "Восемь рук — восемь героев",
    art_description: "An octopus wearing eight tiny headsets, each arm on a different keyboard",
  },
} as unknown as CardPortrait;

describe("промпт художника", () => {
  it("свет берётся из палитры", () => {
    expect(buildImagePrompt(portrait, "void", "snow")).toContain("whiteout snowfall");
    expect(buildImagePrompt(portrait, "void", "desertHeat")).toContain("heat shimmer");
  });

  it("темнота больше не вшита в промпт", () => {
    // Раньше промпт трижды требовал мрака, и любая задумка приезжала тёмной.
    const prompt = buildImagePrompt(portrait, "void", "noon").toLowerCase();
    expect(prompt).not.toContain("dark moody background");
  });

  it("людей на картинке быть не должно", () => {
    // Модель писала в art_scene «одинокая фигура у мониторов», и художник
    // рисовал именно человека, а не духа.
    expect(buildImagePrompt(portrait, "void", "noon").toLowerCase()).toContain("no humans");
  });

  it("описание духа берётся от модели", () => {
    expect(buildImagePrompt(portrait, "void", "noon")).toContain("eight tiny headsets");
  });

  it("рамка зависит от стихии и редкости", () => {
    expect(buildImagePrompt(portrait, "iron", "noon")).toContain("riveted steel");
    expect(buildImagePrompt({ ...portrait, rarity: "legendary" } as CardPortrait, "iron", "noon"))
      .toContain("divine radiance");
  });
});
