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
    expect(Object.keys(teaser)).toEqual(["player", "stats"]);
    expect(Object.keys(teaser.player).sort()).toEqual(["avatar", "name", "steamLevel"]);
    expect(Object.keys(teaser.stats).sort()).toEqual(["totalGames", "totalPlaytimeHours"]);
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
