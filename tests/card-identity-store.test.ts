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
