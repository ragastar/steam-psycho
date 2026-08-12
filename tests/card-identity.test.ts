import { describe, it, expect } from "vitest";
import { selectCardIdentity, mostDistinctiveTrait, creatureClassHint, CREATURE_CLASSES, PALETTE_HINTS } from "@/lib/art/card-identity";
import type { AggregatedProfile } from "@/lib/aggregation/types";
import type { CardStats } from "@/lib/aggregation/aggregate";

/** Человек ровно средний по всем чертам, кроме заданных. */
function statsOf(overrides: Partial<CardStats> = {}): CardStats {
  return { dedication: 84, mastery: 63, exploration: 60, hoarding: 40, social: 53, veteran: 70, ...overrides };
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
    // Упорство 84 — середина по всем, кто дошёл до разбора: оно не отличает
    // никого ни от кого. Барахольство 90 при середине 40 отличает сильно.
    expect(mostDistinctiveTrait(statsOf({ hoarding: 90 }))).toBe("hoarding");
    // Провал по черте говорит о человеке столько же, сколько всплеск.
    expect(mostDistinctiveTrait(statsOf({ hoarding: 0 }))).toBe("hoarding");
  });

  it("отклонение мерится в долях разброса самой черты, а не от её середины", () => {
    // Упорство держится в узком коридоре, барахольство гуляет вдвое шире.
    // Одна и та же разница в очках значит по ним разное: +14 к упорству —
    // это два разброса, +14 к барахольству — меньше одного.
    expect(mostDistinctiveTrait(statsOf({ dedication: 98, hoarding: 54 }))).toBe("dedication");
  });

  it("класс существа берётся из пула выделяющейся черты", () => {
    const id = selectCardIdentity(profileOf(), statsOf({ hoarding: 90 }), "76561198000000001");
    expect(["crustaceans", "insects", "mustelids"]).toContain(id.creatureClass);
  });

  it("двое с одинаковой выделяющейся чертой получают разные классы", () => {
    const stats = statsOf({ hoarding: 90 });
    const classes = new Set(
      ["1", "2", "3", "4", "5"].map((n) => selectCardIdentity(profileOf(), stats, "7656119800000000" + n).creatureClass),
    );
    expect(classes.size).toBeGreaterThan(1);
  });

  it("классов четырнадцать, и в каждом не меньше пяти примеров", () => {
    const keys = Object.keys(CREATURE_CLASSES);
    expect(keys).toHaveLength(14);
    for (const key of keys) {
      expect(CREATURE_CLASSES[key as keyof typeof CREATURE_CLASSES].examples.length).toBeGreaterThanOrEqual(5);
    }
  });

  it("грызуны — один класс из четырнадцати, а не половина выдачи", () => {
    // Ради этого всё и затевалось: восемь духов из пятнадцати были грызунами.
    const labels = Object.values(CREATURE_CLASSES).map((c) => c.label);
    expect(labels.filter((label) => /rodent|burrow/i.test(label))).toHaveLength(1);
  });

  it("порядок примеров крутится по людям", () => {
    // Первый пример в списке модель берёт чаще прочих: подсказка для насекомых
    // начиналась с «dung beetle», и навозный жук вышел трижды из трёх.
    const firsts = new Set(
      ["1", "2", "3", "4", "5"].map((n) => creatureClassHint("insects", "7656119800000000" + n).match(/for example ([^,]+)/)![1]),
    );
    expect(firsts.size).toBeGreaterThan(1);
  });

  it("подсказка перечисляет весь класс, а не один пример", () => {
    const hint = creatureClassHint("insects", "1");
    for (const example of CREATURE_CLASSES.insects.examples) expect(hint).toContain(example);
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
