import { describe, it, expect } from "vitest";
import { toTeaserProfile } from "@/lib/access/redact";
import { buildAggregatedProfile } from "@/lib/aggregation/aggregate";
import { player, game, noBadges, noAchievements, noRecent } from "./fixtures";

const full = buildAggregatedProfile(
  player(),
  [game({ name: "Секретная игра" })],
  noRecent,
  10,
  [],
  noBadges,
  noAchievements,
);

describe("урезание профиля до открытия доступа (MON-1)", () => {
  const teaser = toTeaserProfile(full);
  const serialized = JSON.stringify(teaser);

  it("оставляет только витрину: имя, аватар, уровень, игры, часы", () => {
    expect(Object.keys(teaser).sort()).toEqual(["__teaser", "player", "stats"]);
    expect(Object.keys(teaser.player).sort()).toEqual(["avatar", "name", "steamLevel"]);
    expect(Object.keys(teaser.stats).sort()).toEqual(["totalGames", "totalPlaytimeHours"]);
  });

  it("проставляет метку урезанного профиля", () => {
    // Сама непроходимость типов тестом не выражается: полный профиль перестаёт
    // подходить под TeaserProfile на СБОРКЕ. Но замок держится на этом поле, и
    // если его снесут как мусор, компилятор снова пропустит `profile={profile}`
    // мимо `toTeaserProfile` — а вместе с ним и весь платный профиль в браузер.
    expect(teaser.__teaser).toBe(true);
  });

  it("не пропускает наружу закрытые разделы", () => {
    for (const key of ["topGames", "economics", "achievements", "patterns", "ranks", "social", "tagDistribution"]) {
      expect(serialized).not.toContain(key);
    }
  });

  it("не пропускает названия игр", () => {
    expect(serialized).not.toContain("Секретная игра");
  });
});
