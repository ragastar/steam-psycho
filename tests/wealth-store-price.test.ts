import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchSpy = vi.fn();
vi.stubGlobal("fetch", fetchSpy);
vi.mock("@/lib/cache/redis", () => ({
  cached: async (_k: string, _t: number, fetcher: () => Promise<unknown>) => fetcher(),
}));
vi.mock("@/lib/wealth/fx", () => ({
  getRates: async () => ({ usdRub: 80, eurRub: 95 }),
  FX_TTL: 1,
}));

function storeResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

beforeEach(() => fetchSpy.mockReset());

describe("цена игры", () => {
  it("берёт российскую цену как есть", async () => {
    fetchSpy.mockResolvedValueOnce(
      storeResponse({ "570": { success: true, data: { is_free: false, price_overview: { final: 99900 } } } }),
    );
    const { getGamePrice } = await import("@/lib/wealth/store-price");
    expect(await getGamePrice(570)).toEqual({ rub: 999, isFree: false, source: "ru", genres: [] });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("добирает американскую цену по курсу, когда в РФ игры нет", async () => {
    fetchSpy
      .mockResolvedValueOnce(storeResponse({ "10": { success: true, data: { is_free: false } } }))
      .mockResolvedValueOnce(
        storeResponse({ "10": { success: true, data: { is_free: false, price_overview: { final: 1999 } } } }),
      );
    const { getGamePrice } = await import("@/lib/wealth/store-price");
    expect(await getGamePrice(10)).toEqual({ rub: 1599.2, isFree: false, source: "us", genres: [] });
  });

  it("бесплатную игру не пытается оценивать вторым запросом", async () => {
    fetchSpy.mockResolvedValueOnce(storeResponse({ "440": { success: true, data: { is_free: true } } }));
    const { getGamePrice } = await import("@/lib/wealth/store-price");
    expect(await getGamePrice(440)).toEqual({ isFree: true, source: "none", genres: [] });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("молчащий магазин — это отсутствие цены, а не исключение", async () => {
    fetchSpy.mockResolvedValue(new Response("", { status: 429 }));
    const { getGamePrice } = await import("@/lib/wealth/store-price");
    expect(await getGamePrice(777)).toEqual({ isFree: false, source: "none", genres: [] });
  });

  it("отдаёт жанры из того же российского ответа, что и цену — без второго похода в магазин", async () => {
    fetchSpy.mockResolvedValueOnce(
      storeResponse({
        "570": {
          success: true,
          data: {
            is_free: false,
            price_overview: { final: 99900 },
            genres: [{ description: "Action" }, { description: "Strategy" }],
          },
        },
      }),
    );
    const { getGamePrice } = await import("@/lib/wealth/store-price");
    const result = await getGamePrice(570);
    expect(result.genres).toEqual(["Action", "Strategy"]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("если в РФ игры нет, жанры всё равно находятся — в американском ответе", async () => {
    fetchSpy
      .mockResolvedValueOnce(storeResponse({ "10": { success: false } }))
      .mockResolvedValueOnce(
        storeResponse({
          "10": {
            success: true,
            data: {
              is_free: false,
              price_overview: { final: 1999 },
              genres: [{ description: "RPG" }],
            },
          },
        }),
      );
    const { getGamePrice } = await import("@/lib/wealth/store-price");
    const result = await getGamePrice(10);
    expect(result.genres).toEqual(["RPG"]);
  });
});
