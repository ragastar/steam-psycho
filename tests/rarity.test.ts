import { describe, it, expect } from "vitest";
import { calculateRarity, profileStrength } from "@/lib/aggregation/aggregate";
import type { AggregatedProfile } from "@/lib/aggregation/types";

const person = (hours: number, games: number, age: number) =>
  ({ stats: { totalPlaytimeHours: hours, totalGames: games }, timeline: { accountAge: age } }) as unknown as AggregatedProfile;

describe("сила профиля", () => {
  it("не упирается в потолок на нашей аудитории", () => {
    // Прежняя линейная мера давала на 29 разборах семь различимых значений:
    // часы упирались в потолок 5000 почти у всех. Логарифм разводит и тех,
    // у кого 6 тысяч часов, и тех, у кого 18 тысяч.
    const values = [person(4201, 24, 14), person(5913, 157, 12), person(17214, 171, 15), person(36945, 39805, 21)]
      .map(profileStrength);
    const rounded = new Set(values.map((v) => v.toFixed(2)));
    expect(rounded.size).toBe(4);
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThan(values[i - 1]);
  });

  it("не выходит за единицу даже у самого крайнего аккаунта", () => {
    expect(profileStrength(person(200000, 90000, 30))).toBeLessThanOrEqual(1);
  });
});

describe("редкость", () => {
  it("без выборки пользуется порогами из кода, и легендарка достаётся не всем", () => {
    // Живой случай: 5913 часов и 157 игр. Таких у нас большинство, и по старой
    // формуле легендарными были 27 карточек из 27.
    expect(calculateRarity(person(5913, 157, 12), null)).toBe("epic");
    expect(calculateRarity(person(500, 80, 8), null)).toBe("uncommon");
    expect(calculateRarity(person(100, 20, 2), null)).toBe("common");
    expect(calculateRarity(person(2000, 150, 10), null)).toBe("rare");
    expect(calculateRarity(person(36945, 39805, 21), null)).toBe("legendary");
  });

  it("маленькую выборку игнорирует — по ней ранг ничего не значит", () => {
    const tiny = Array.from({ length: 10 }, () => 0.99);
    expect(calculateRarity(person(100, 20, 2), tiny)).toBe("common");
  });

  it("с набранной выборкой редкость — это место в ней", () => {
    // Ровная выборка от 0 до 1: место в ней читается напрямую.
    const sample = Array.from({ length: 60 }, (_, i) => i / 60);
    expect(calculateRarity(person(36945, 39805, 21), sample)).toBe("legendary");
    // Сила 0.37 — это 38-й перцентиль такой выборки, то есть ниже середины,
    // но не самый низ: «необычная», а не «обычная».
    expect(calculateRarity(person(100, 20, 2), sample)).toBe("uncommon");
    expect(calculateRarity(person(1, 1, 0), sample)).toBe("common");
  });

  it("в выборке из одинаково сильных людей место наверху занять нельзя", () => {
    // Если все вокруг такие же, легендарки не получает никто: перцентиль
    // считает тех, кто СТРОГО ниже.
    const clones = Array.from({ length: 60 }, () => profileStrength(person(17214, 171, 15)));
    expect(calculateRarity(person(17214, 171, 15), clones)).toBe("common");
  });
});
