import { describe, it, expect } from "vitest";
import { toFreePortrait } from "@/lib/access/redact-portrait";
import type { CardPortrait, Roast } from "@/lib/llm/types";
import { portraitFixture, lockedStrings } from "./fixtures";

describe("урезание карточки до оплаты (MON-2)", () => {
  const portrait = portraitFixture();
  const free = toFreePortrait(portrait);
  const serialized = JSON.stringify(free);

  it("оставляет бесплатную часть: вердикт, редкость, цифры, игру души", () => {
    expect(free.primaryArchetype).toEqual(portrait.primaryArchetype);
    expect(free.title).toBe(portrait.title);
    expect(free.emoji).toBe(portrait.emoji);
    expect(free.rarity).toBe(portrait.rarity);
    expect(free.stats).toEqual(portrait.stats);
    expect(free.spirit_game).toBe(portrait.spirit_game);
  });

  it("отдаёт ровно один роаст, и это самый суровый", () => {
    expect(free.roasts).toHaveLength(1);
    expect(free.roasts[0]).toEqual(portrait.roasts[2]);
  });

  it("ГЛАВНОЕ: ни одно закрытое слово не уезжает в браузер", () => {
    for (const secret of lockedStrings(portrait)) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("отдаёт ровно перечисленные поля и ничего сверх", () => {
    // Белый список, а не чёрный: новое поле карточки обязано появиться здесь
    // осознанно, а не просочиться потому, что о нём забыли.
    expect(Object.keys(free).sort()).toEqual([
      "emoji",
      "lockedRoasts",
      "primaryArchetype",
      "rarity",
      "roasts",
      "spirit_game",
      "stats",
      "title",
    ]);
  });

  it("не отдаёт закрытые разделы даже пустыми ключами", () => {
    for (const key of [
      "psycho_profile",
      "lore",
      "quote",
      "spirit_animal",
      "secondaryArchetype",
      "shadowArchetype",
      "art_mood",
      "art_scene",
    ]) {
      expect(serialized).not.toContain(key);
      expect(free).not.toHaveProperty(key);
    }
  });

  it("показывает объём покупки: пустышек столько же, сколько закрытых роастов", () => {
    expect(free.lockedRoasts).toHaveLength(portrait.roasts.length - 1);
  });

  it("у пустышек настоящие icon и severity, но выдуманные слова", () => {
    const hidden = portrait.roasts.filter((_, i) => i !== 2);
    expect(free.lockedRoasts.map((r) => r.severity)).toEqual(hidden.map((r) => r.severity));
    expect(free.lockedRoasts.map((r) => r.icon)).toEqual(hidden.map((r) => r.icon));

    const realTexts = portrait.roasts.flatMap((r) => [r.title, r.text, r.stat]);
    for (const dummy of free.lockedRoasts) {
      expect(realTexts).not.toContain(dummy.text);
      expect(realTexts).not.toContain(dummy.title);
      expect(dummy.text.length).toBeGreaterThan(0);
      expect(dummy.title.length).toBeGreaterThan(0);
    }
  });

  it("пустышка не зависит от содержимого карточки", () => {
    // Если бы заглушка порождалась из настоящего текста (перемешиванием,
    // заменой букв, обрезкой), она тащила бы наружу его форму. Одинаковые
    // пустышки на двух разных карточках доказывают, что она выдумана.
    const other = toFreePortrait(portraitFixture("-ДРУГОЙ"));
    expect(other.lockedRoasts.map((r) => r.text)).toEqual(free.lockedRoasts.map((r) => r.text));
    expect(other.lockedRoasts.map((r) => r.title)).toEqual(free.lockedRoasts.map((r) => r.title));
    expect(other.lockedRoasts.map((r) => r.stat)).toEqual(free.lockedRoasts.map((r) => r.stat));
  });

  it("не роняет страницу на битой карточке без роастов", () => {
    const broken = { ...portraitFixture(), roasts: [] } as unknown as CardPortrait;
    const result = toFreePortrait(broken);
    expect(result.roasts).toHaveLength(0);
    expect(result.lockedRoasts).toHaveLength(0);
  });

  it("при незнакомой severity не считает роаст самым суровым", () => {
    // Кеш живёт сутками и переживает смену схемы: в старой карточке может
    // лежать severity, о которой код не знает. Такой роаст обязан оказаться
    // в конце очереди, а не открыться бесплатно вместо critical.
    const withJunk = portraitFixture();
    const junk = { ...withJunk.roasts[0], severity: "апокалипсис" } as unknown as Roast;
    const result = toFreePortrait({ ...withJunk, roasts: [junk, ...withJunk.roasts.slice(1)] });
    expect(result.roasts[0]?.severity).toBe("critical");
  });
});
