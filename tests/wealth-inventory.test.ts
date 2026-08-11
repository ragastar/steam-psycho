import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchSpy = vi.fn();
vi.stubGlobal("fetch", fetchSpy);
vi.mock("@/lib/wealth/market-prices", () => ({
  getMarketPrices: async () => ({ "Дорогой нож": 100, "Ящик": 1.5 }),
  MARKET_TTL: 1,
}));

/** Пять одинаковых ящиков: в описаниях одна строка, в активах пять. */
const INVENTORY = {
  assets: [
    { classid: "1", instanceid: "0", amount: "1" },
    ...Array.from({ length: 5 }, () => ({ classid: "2", instanceid: "0", amount: "1" })),
    { classid: "3", instanceid: "0", amount: "1" },
  ],
  descriptions: [
    { classid: "1", instanceid: "0", market_hash_name: "Дорогой нож", marketable: 1 },
    { classid: "2", instanceid: "0", market_hash_name: "Ящик", marketable: 1 },
    { classid: "3", instanceid: "0", market_hash_name: "10 Year Veteran Coin", marketable: 0 },
  ],
  total_inventory_count: 7,
};

beforeEach(() => {
  fetchSpy.mockReset();
  vi.resetModules();
});

describe("инвентарь", () => {
  it("считает по экземплярам, а не по строкам списка", async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify(INVENTORY), { status: 200 }));
    const { fetchAppInventory } = await import("@/lib/wealth/inventory");
    const inv = await fetchAppInventory("76561198140642959", 730, 2);

    expect(inv.status).toBe("ok");
    // 100 за нож + 5 × 1.5 за ящики
    expect(inv.totalEur).toBeCloseTo(107.5, 2);
    expect(inv.items.find((i) => i.name === "Ящик")?.qty).toBe(5);
  });

  it("невыставляемые предметы не идут в сумму, но остаются в списке", async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify(INVENTORY), { status: 200 }));
    const { fetchAppInventory } = await import("@/lib/wealth/inventory");
    const inv = await fetchAppInventory("1", 730, 2);
    const coin = inv.items.find((i) => i.name === "10 Year Veteran Coin");
    expect(coin?.marketable).toBe(false);
    expect(coin?.priceEur).toBeUndefined();
  });

  it("закрытый инвентарь — это состояние, а не ошибка", async () => {
    fetchSpy.mockResolvedValue(new Response("", { status: 403 }));
    const { fetchAppInventory } = await import("@/lib/wealth/inventory");
    const inv = await fetchAppInventory("1", 730, 2);
    expect(inv.status).toBe("private");
    expect(inv.items).toEqual([]);
  });

  it("пустой ответ Steam (игры у человека нет) — это пустой инвентарь", async () => {
    fetchSpy.mockResolvedValue(new Response("null", { status: 200 }));
    const { fetchAppInventory } = await import("@/lib/wealth/inventory");
    const inv = await fetchAppInventory("1", 440, 2);
    expect(inv.status).toBe("ok");
    expect(inv.itemCount).toBe(0);
  });

  it("обрыв связи — недоступность, разбор не падает", async () => {
    fetchSpy.mockRejectedValue(new Error("network"));
    const { fetchAppInventory } = await import("@/lib/wealth/inventory");
    expect((await fetchAppInventory("1", 730, 2)).status).toBe("unavailable");
  });
});
