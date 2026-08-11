import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OwnedGame } from "@/lib/steam/types";

// Никаких реальных походов наружу: считаем, сколько раз код полез бы в сеть.
const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
vi.stubGlobal("fetch", fetchSpy);

// Кеш ходит в SQLite — подменяем на пустышку, тут проверяется только объём работы.
vi.mock("@/lib/cache/redis", () => ({
  cached: async (_k: string, _t: number, fetcher: () => Promise<unknown>) => fetcher(),
}));

function library(n: number): OwnedGame[] {
  return Array.from({ length: n }, (_, i) => ({
    appid: i + 1,
    name: `Game ${i + 1}`,
    playtime_forever: (n - i) * 10,
    img_icon_url: "icon",
  }));
}

beforeEach(() => fetchSpy.mockClear());

describe("потолок обогащения (MON-7)", () => {
  it("не ходит в сеть за каждой игрой гигантской библиотеки", async () => {
    const { enrichGames } = await import("@/lib/steam/enrich");
    const result = await enrichGames(library(5000));

    // Все игры остаются в выдаче — статистика по количеству не врёт.
    expect(result).toHaveLength(5000);

    // Но запросов наружу — единицы сотен, а не 5000+. Порог ниже, чем был
    // сразу после смены базы цен (там было < 1000): жанры топ-игр больше не
    // ходят в магазин отдельным запросом (fetchStoreData убран) — они едут в
    // том же ответе, что и цена. На 300 обогащаемых играх (30 топ + 270
    // остальных, по SteamSpy(1) + getGamePrice ru/us(2) = 3 запроса на игру
    // без своей цены в моке) фактическое число — 900.
    expect(fetchSpy.mock.calls.length).toBeLessThan(950);
  }, 120_000);

  it("игры сверх потолка попадают в результат без тегов и жанров", async () => {
    const { enrichGames } = await import("@/lib/steam/enrich");
    const result = await enrichGames(library(400));

    const tail = result[result.length - 1];
    expect(tail.tags).toEqual({});
    expect(tail.genres).toEqual([]);
  }, 120_000);

  it("не ходит в магазин за жанрами отдельно от цены — жанры едут вместе с getGamePrice", async () => {
    const { enrichGames } = await import("@/lib/steam/enrich");
    await enrichGames(library(1), 1);

    // Одна топ-игра: SteamSpy (1) + getGamePrice — ru и us, цены в моке нет
    // ни там, ни там (2). Итого 3, а не 4 — отдельного похода за жанрами нет.
    expect(fetchSpy.mock.calls.length).toBe(3);
  }, 120_000);
});
