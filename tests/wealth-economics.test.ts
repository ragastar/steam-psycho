import { describe, it, expect } from "vitest";
import { buildAggregatedProfile } from "@/lib/aggregation/aggregate";
import type { EnrichedGame } from "@/lib/steam/types";
import { player, noBadges, noAchievements, noRecent } from "./fixtures";

function priced(appid: number, rub: number | undefined, playtime: number, enriched = true): EnrichedGame {
  return {
    appid,
    name: `Game ${appid}`,
    playtime_forever: playtime,
    img_icon_url: "icon",
    tags: {},
    genres: [],
    price: rub,
    isFree: false,
    enriched,
    priceSource: rub === undefined ? "none" : "ru",
  };
}

describe("экономика на единой базе цен", () => {
  it("помечает валюту рублями", () => {
    const profile = buildAggregatedProfile(
      player(), [priced(1, 1000, 600), priced(2, 500, 0)], noRecent, 10, [], noBadges, noAchievements,
    );
    expect(profile.economics.currency).toBe("RUB");
    expect(profile.economics.totalLibraryValue).toBe(1500);
    expect(profile.economics.wastedValue).toBe(500);
  });

  it("достраивает хвост сверх потолка средней ценой посчитанных", () => {
    const games = [priced(1, 1000, 600), priced(2, 2000, 600), priced(3, undefined, 60, false)];
    const profile = buildAggregatedProfile(
      player(), games, noRecent, 10, [], noBadges, noAchievements,
    );
    // 1000 + 2000 + средняя 1500 за необогащённую
    expect(profile.economics.totalLibraryValue).toBe(4500);
    expect(profile.economics.estimatedGames).toBe(1);
    expect(profile.economics.pricedGames).toBe(2);
  });

  it("игру без цены, о которой магазин молчал, в сумму не выдумывает", () => {
    const games = [priced(1, 1000, 600), priced(2, undefined, 600, true)];
    const profile = buildAggregatedProfile(
      player(), games, noRecent, 10, [], noBadges, noAchievements,
    );
    expect(profile.economics.totalLibraryValue).toBe(1000);
    expect(profile.economics.unknownGames).toBe(1);
    expect(profile.economics.estimatedGames).toBe(0);
  });
});
