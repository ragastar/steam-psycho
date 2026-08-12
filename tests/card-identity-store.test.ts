import { describe, it, expect, vi, beforeEach } from "vitest";

const store = new Map<string, unknown>();

vi.mock("@/lib/cache/redis", () => ({
  getCache: async (key: string) => store.get(key) ?? null,
  setCache: async (key: string, value: unknown) => void store.set(key, value),
}));

const profile = {
  genreDistribution: [{ genre: "Horror", percentage: 20 }],
  tagDistribution: [],
} as never;
const stats = { dedication: 86, mastery: 67, exploration: 56, hoarding: 80, social: 47, veteran: 66 };

/** Разбора хватает ровно на то, что считают спутники карточки. */
const fullProfile = {
  ...(profile as object),
  player: { steamId64: "76561198000000003", steamLevel: 10 },
  stats: { totalPlaytimeHours: 5000, totalGames: 150, unplayedCount: 10, unplayedPercentage: 7, avgPlaytimeHours: 30, medianPlaytimeHours: 5 },
  timeline: { accountAge: 12, peakYear: null, medianReleaseYear: null, gamesPerYear: 10 },
  topGames: [],
  achievements: { averageCompletion: 20, perfectGames: 0, totalUnlocked: 0, topGames: [] },
  social: { friendsCount: 10, friendsAddedPerYear: 1, oldestFriendYears: 5 },
  badges: { totalCount: 5, totalXP: 100 },
  concentrationRatio: 60,
  multiplayerRatio: 50,
  singleplayerRatio: 50,
  patterns: { indiePercentage: 5, completionist: false, bingeGamer: true, socialGamer: false, trend: "stable" },
  economics: { totalLibraryValue: 100000, wastedValue: 10000, perHourCost: 20, bestDeal: null, freePercentage: 10, currency: "RUB" },
} as never;

beforeEach(() => store.clear());

describe("хранение личности карточки", () => {
  it("выбранная личность записывается, а не считается заново каждым, кому нужна", async () => {
    // Разбор берётся из кеша чаще, чем считается: у покупателя он лежит десять
    // лет, и полный путь разбора — единственный, кто раньше писал эту запись, —
    // не выполняется вовсе. Тогда художник не находил ничего и красил всем
    // одинаковую рамку и одинаковый свет.
    const { ensureCardIdentity } = await import("@/lib/art/identity-store");
    const { artIdentityKey } = await import("@/lib/cache/keys");

    const identity = await ensureCardIdentity(profile, stats, "76561198000000001");

    expect(store.get(artIdentityKey("76561198000000001"))).toEqual(identity);
    expect(identity.element).toBe("shadow");
  });

  it("готовая запись переиспользуется, а не переписывается", async () => {
    const { ensureCardIdentity } = await import("@/lib/art/identity-store");
    const { artIdentityKey } = await import("@/lib/cache/keys");
    const existing = { creatureClass: "mythic", element: "blood", palette: "dawn" };
    store.set(artIdentityKey("76561198000000002"), existing);

    expect(await ensureCardIdentity(profile, stats, "76561198000000002")).toEqual(existing);
  });
});

describe("достройка спутников карточки по готовому разбору", () => {
  it("считает недостающие цифры, редкость и личность", async () => {
    // Ключ спутника получил новую версию — записи под старой больше не видно.
    // Разбор при этом лежит в кеше и заново не посчитается: он выходит раньше.
    const { ensureCardCompanions } = await import("@/lib/aggregation/companions");
    const { artIdentityKey, cardStatsKey, rarityKey } = await import("@/lib/cache/keys");

    const out = await ensureCardCompanions("76561198000000003", fullProfile);

    expect(store.get(cardStatsKey("76561198000000003"))).toEqual(out.cardStats);
    expect(store.get(rarityKey("76561198000000003"))).toEqual(out.rarity);
    expect(store.get(artIdentityKey("76561198000000003"))).toEqual(out.identity);
  });

  it("готовое не переписывает", async () => {
    const { ensureCardCompanions } = await import("@/lib/aggregation/companions");
    const { rarityKey } = await import("@/lib/cache/keys");
    store.set(rarityKey("76561198000000004"), "common");

    const out = await ensureCardCompanions("76561198000000004", fullProfile);

    expect(out.rarity).toBe("common");
  });
});
