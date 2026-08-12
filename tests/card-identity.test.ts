import { describe, it, expect } from "vitest";
import { selectCardIdentity, mostDistinctiveTrait, CREATURE_CLASS_HINTS, PALETTE_HINTS } from "@/lib/art/card-identity";
import type { AggregatedProfile } from "@/lib/aggregation/types";
import type { CardStats } from "@/lib/aggregation/aggregate";

/** Человек ровно средний по всем чертам, кроме заданных. */
function statsOf(overrides: Partial<CardStats> = {}): CardStats {
  return { dedication: 86, mastery: 67, exploration: 56, hoarding: 34, social: 47, veteran: 66, ...overrides };
}

function profileOf(
  genres: [string, number][] = [["Action", 40]],
  tags: [string, number][] = [["FPS", 30]],
): AggregatedProfile {
  return {
    genreDistribution: genres.map(([genre, percentage]) => ({ genre, percentage })),
    tagDistribution: tags.map(([tag, percentage]) => ({ tag, percentage })),
  } as unknown as AggregatedProfile;
}

describe("выбор класса существа", () => {
  it("берёт самую выделяющуюся черту, а не самую высокую", () => {
    // Упорство 86 — среднее по всем, кто дошёл до разбора: оно не отличает
    // никого ни от кого. Барахольство 80 при типичных 34 отличает сильно.
    expect(mostDistinctiveTrait(statsOf({ hoarding: 80 }))).toBe("hoarding");
    // Провал по черте говорит о человеке столько же, сколько всплеск.
    expect(mostDistinctiveTrait(statsOf({ hoarding: 5 }))).toBe("hoarding");
  });

  it("класс существа берётся из пула выделяющейся черты", () => {
    const id = selectCardIdentity(profileOf(), statsOf({ hoarding: 80 }), "76561198000000001");
    expect(["crustaceans", "insects", "mustelids"]).toContain(id.creatureClass);
  });

  it("двое с одинаковой выделяющейся чертой получают разные классы", () => {
    const stats = statsOf({ hoarding: 80 });
    const classes = new Set(
      ["1", "2", "3", "4", "5"].map((n) => selectCardIdentity(profileOf(), stats, "7656119800000000" + n).creatureClass),
    );
    expect(classes.size).toBeGreaterThan(1);
  });

  it("классов четырнадцать, и у каждого есть подсказка для модели", () => {
    const keys = Object.keys(CREATURE_CLASS_HINTS);
    expect(keys).toHaveLength(14);
    for (const key of keys) {
      expect(CREATURE_CLASS_HINTS[key as keyof typeof CREATURE_CLASS_HINTS].length).toBeGreaterThan(10);
    }
  });

  it("грызуны — один класс из четырнадцати, а не половина выдачи", () => {
    // Ради этого всё и затевалось: восемь духов из пятнадцати были грызунами.
    const pools = Object.values(CREATURE_CLASS_HINTS);
    expect(pools.filter((hint) => /rodent|burrow/i.test(hint))).toHaveLength(1);
  });

  it("палитра расходится по людям и воспроизводима", () => {
    const stats = statsOf();
    const palettes = new Set(
      ["1", "2", "3", "4", "5", "6"].map((n) => selectCardIdentity(profileOf(), stats, "7656119800000000" + n).palette),
    );
    expect(palettes.size).toBeGreaterThan(2);
    for (const value of Object.values(PALETTE_HINTS)) expect(value.length).toBeGreaterThan(10);
  });

  it("тот же Steam ID — тот же результат", () => {
    const a = selectCardIdentity(profileOf(), statsOf({ social: 90 }), "76561198000000009");
    const b = selectCardIdentity(profileOf(), statsOf({ social: 90 }), "76561198000000009");
    expect(a).toEqual(b);
  });
});

describe("выбор стихии", () => {
  it("частая тема не побеждает сама по себе", () => {
    // Шутеры есть у всех: 40% при типичных 40 не значат ничего. Хоррор 12%
    // при типичных нуле — значит. Прежний код брал самое частое и выдавал
    // огонь или природу почти всем: из десяти стихий встречались три.
    const profile = profileOf([["Action", 40], ["Horror", 12]], []);
    expect(selectCardIdentity(profile, statsOf(), "1").element).toBe("shadow");
  });

  it("профиль без выделяющихся тем получает стихию по умолчанию, а не огонь", () => {
    expect(selectCardIdentity(profileOf([["Action", 40]], []), statsOf(), "1").element).toBe("arcane");
  });

  it("теги учитываются наравне с жанрами", () => {
    const profile = profileOf([["Action", 40]], [["Automation", 20], ["Base Building", 15]]);
    expect(selectCardIdentity(profile, statsOf(), "1").element).toBe("iron");
  });
});
