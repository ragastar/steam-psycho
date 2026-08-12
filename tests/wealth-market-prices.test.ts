import { describe, it, expect, vi, beforeEach } from "vitest";
import { brotliCompressSync } from "node:zlib";

const fetchSpy = vi.fn();
vi.stubGlobal("fetch", fetchSpy);
vi.mock("@/lib/cache/redis", () => ({
  cached: async (_k: string, _t: number, fetcher: () => Promise<unknown>) => fetcher(),
}));

const ITEMS = [
  // Ровно тот случай, ради которого берётся оценка, а не минимальный лот:
  // один мусорный лот в 180 раз дороже настоящей цены предмета.
  { market_hash_name: "Sealed Genesis Terminal", suggested_price: 0.11, median_price: 19.92, min_price: 19.92 },
  { market_hash_name: "AWP | Exothermic (Factory New)", suggested_price: 15.03, median_price: 11.36, min_price: 9.72 },
  { market_hash_name: "Без оценки", suggested_price: null, median_price: 3.5, min_price: 2 },
  { market_hash_name: "Совсем без цены", suggested_price: null, median_price: null, min_price: null },
];

beforeEach(() => fetchSpy.mockReset());

describe("прайс-лист рынка", () => {
  it("берёт оценку предмета, а не самый дешёвый лот", async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify(ITEMS), { status: 200 }));
    const { getMarketPrices } = await import("@/lib/wealth/market-prices");
    const prices = await getMarketPrices(730);
    expect(prices?.["Sealed Genesis Terminal"]).toBe(0.11);
    expect(prices?.["AWP | Exothermic (Factory New)"]).toBe(15.03);
  });

  it("падает на медиану, когда оценки нет, и пропускает предметы без цен вовсе", async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify(ITEMS), { status: 200 }));
    const { getMarketPrices } = await import("@/lib/wealth/market-prices");
    const prices = await getMarketPrices(730);
    expect(prices?.["Без оценки"]).toBe(3.5);
    expect(prices).not.toHaveProperty("Совсем без цены");
  });

  it("разжимает ответ, сжатый brotli", async () => {
    const packed = brotliCompressSync(Buffer.from(JSON.stringify(ITEMS)));
    fetchSpy.mockResolvedValue(new Response(packed, { status: 200 }));
    const { getMarketPrices } = await import("@/lib/wealth/market-prices");
    const prices = await getMarketPrices(730);
    expect(prices?.["AWP | Exothermic (Factory New)"]).toBe(15.03);
  });

  it("просит brotli заголовком — без него рынок отвечает отказом", async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify(ITEMS), { status: 200 }));
    const { getMarketPrices } = await import("@/lib/wealth/market-prices");
    await getMarketPrices(730);
    const init = fetchSpy.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers["Accept-Encoding"]).toContain("br");
  });

  it("недоступный рынок — это null, а не исключение", async () => {
    fetchSpy.mockResolvedValue(new Response("", { status: 406 }));
    const { getMarketPrices } = await import("@/lib/wealth/market-prices");
    expect(await getMarketPrices(730)).toBeNull();
  });

  it("предмет с ценой ровно 0 попадает в карту, а не выбрасывается", async () => {
    const itemsWithZero = [
      { market_hash_name: "Фриби", suggested_price: 0, median_price: 0.5, min_price: 0.3 },
    ];
    fetchSpy.mockResolvedValue(new Response(JSON.stringify(itemsWithZero), { status: 200 }));
    const { getMarketPrices } = await import("@/lib/wealth/market-prices");
    const prices = await getMarketPrices(730);
    expect(prices?.["Фриби"]).toBe(0);
    expect(prices).toHaveProperty("Фриби");
  });
});
