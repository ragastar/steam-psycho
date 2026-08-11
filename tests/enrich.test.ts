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

    // Но запросов наружу — единицы сотен, а не 5000+. Порог выше, чем был:
    // единая база цен спрашивает getGamePrice (до двух запросов — ru и us)
    // и для игр сверх топ-N, а не только парсит уже загруженный SteamSpy.
    expect(fetchSpy.mock.calls.length).toBeLessThan(1000);
  }, 120_000);

  it("игры сверх потолка попадают в результат без тегов и жанров", async () => {
    const { enrichGames } = await import("@/lib/steam/enrich");
    const result = await enrichGames(library(400));

    const tail = result[result.length - 1];
    expect(tail.tags).toEqual({});
    expect(tail.genres).toEqual([]);
  }, 120_000);
});
