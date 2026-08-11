import { describe, it, expect } from "vitest";
import { buildAggregatedProfile, calculateCardStats, calculateRarity } from "@/lib/aggregation/aggregate";
import { buildUserPrompt } from "@/lib/llm/prompt";
import type { EnrichedGame } from "@/lib/steam/types";
import { player, noBadges, noAchievements, noRecent } from "./fixtures";

function priced(appid: number, rub: number, playtime: number): EnrichedGame {
  return {
    appid,
    name: `Game ${appid}`,
    playtime_forever: playtime,
    img_icon_url: "icon",
    tags: {},
    genres: [],
    price: rub,
    isFree: false,
    enriched: true,
    priceSource: "ru",
  };
}

describe("подпись валюты в пользовательском промпте", () => {
  it("профиль с currency: RUB печатает рубли, а не доллары", () => {
    const games = [priced(1, 1200, 600)]; // 10ч, 120₽/ч
    const profile = buildAggregatedProfile(player(), games, noRecent, 10, [], noBadges, noAchievements);
    expect(profile.economics.currency).toBe("RUB");

    const stats = calculateCardStats(profile);
    const rarity = calculateRarity(profile);
    const prompt = buildUserPrompt(profile, stats, rarity);

    expect(prompt).toContain(`${profile.economics.totalLibraryValue}₽`);
    expect(prompt).toContain(`${profile.economics.wastedValue}₽`);
    expect(prompt).not.toContain(`$${profile.economics.totalLibraryValue}`);
    expect(prompt).not.toContain("$120/h");
  });

  it("старая вечная запись без currency печатает доллары, как раньше", () => {
    const games = [priced(1, 1200, 600)];
    const profile = buildAggregatedProfile(player(), games, noRecent, 10, [], noBadges, noAchievements);
    // Имитация вечной записи покупателя из-под старого кеша: поля currency нет.
    const legacyProfile = { ...profile, economics: { ...profile.economics, currency: undefined } };

    const stats = calculateCardStats(legacyProfile);
    const rarity = calculateRarity(legacyProfile);
    const prompt = buildUserPrompt(legacyProfile, stats, rarity);

    expect(prompt).toContain(`$${legacyProfile.economics.totalLibraryValue}`);
    expect(prompt).toContain(`$${legacyProfile.economics.wastedValue}`);
    expect(prompt).toContain("$120/h");
    expect(prompt).not.toContain("₽");
  });
});
