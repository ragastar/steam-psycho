import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OwnedGame } from "@/lib/steam/types";
import { player, noBadges, noAchievements, noRecent } from "./fixtures";

// Никаких реальных походов наружу: считаем, сколько раз код полез бы в сеть.
const fetchSpy = vi.fn<(...args: unknown[]) => Promise<Response>>(
  async () => new Response("{}", { status: 200 }),
);
vi.stubGlobal("fetch", fetchSpy);

// cached() остаётся сквозным вызовом (как и раньше — тут проверяется объём
// работы, а не факт кеширования). getCache — отдельная ручная подложка под
// peekGamePrice: по умолчанию пустая (холодный кеш), тесты бюджета сами кладут
// туда то, что хотят увидеть «уже посчитанным».
const { fakeCache } = vi.hoisted(() => ({ fakeCache: new Map<string, unknown>() }));
vi.mock("@/lib/cache/redis", () => ({
  cached: async (_k: string, _t: number, fetcher: () => Promise<unknown>) => fetcher(),
  getCache: async (k: string) => (fakeCache.has(k) ? fakeCache.get(k) : null),
}));

function library(n: number): OwnedGame[] {
  return Array.from({ length: n }, (_, i) => ({
    appid: i + 1,
    name: `Game ${i + 1}`,
    playtime_forever: (n - i) * 10,
    img_icon_url: "icon",
  }));
}

function storeCalls(): unknown[] {
  return fetchSpy.mock.calls.filter((call) => String(call[0]).includes("store.steampowered.com"));
}

beforeEach(() => {
  fetchSpy.mockClear();
  fakeCache.clear();
});

describe("потолок обогащения (MON-7)", () => {
  it("не ходит в сеть за каждой игрой гигантской библиотеки", async () => {
    const { enrichGames } = await import("@/lib/steam/enrich");
    const result = await enrichGames(library(5000));

    // Все игры остаются в выдаче — статистика по количеству не врёт.
    expect(result).toHaveLength(5000);

    // Топ-30 обогащаются полностью и бюджет не трогают: SteamSpy(1) +
    // getGamePrice ru/us(2, цены в моке нет нигде) = 3 запроса на игру × 30 = 90.
    //
    // Вторая полоса — до потолка MAX_ENRICHED=300, то есть 270 игр. Каждая
    // сначала даёт SteamSpy-запрос (270, он не про магазин и бюджет не
    // расходует), затем peek в кеш цены (промах — кеш холодный, сетевых
    // запросов не даёт). Из 270 играм только 60 достаётся бюджет свежих
    // походов в магазин (MAX_FRESH_PRICE_LOOKUPS) — на них ru/us(2) = 120
    // запросов; оставшимся 210 цену не спрашивают вовсе (0 запросов, enriched:false).
    // Итого вторая полоса: 270 + 120 = 390.
    //
    // Хвост сверх потолка (5000 - 300 = 4700 игр) — без единого запроса.
    //
    // Итого: 90 + 390 = 480, а не 5000+.
    expect(fetchSpy.mock.calls.length).toBe(480);
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

describe("бюджет свежих цен второй полосы (кошелёк, задача 5)", () => {
  it("на холодном кеше библиотека в 300 игр укладывается меньше чем в 200 обращений в магазин", async () => {
    const { enrichGames } = await import("@/lib/steam/enrich");
    await enrichGames(library(300));

    // Топ-30: 30 × 2 (ru+us) = 60. Вторая полоса — 270 игр, но свежих походов
    // в магазин у неё бюджет всего 60 (MAX_FRESH_PRICE_LOOKUPS) × 2 (ru+us) = 120.
    // Итого 60 + 120 = 180 — ниже двухсот, куда упирается лимит магазина.
    expect(storeCalls().length).toBe(180);
    expect(storeCalls().length).toBeLessThan(200);
  }, 120_000);

  it("игра второй полосы, чья цена уже лежит в кеше, бюджет не тратит", async () => {
    // 1 топ-игра + 61 игра второй полосы, бюджет второй полосы — ровно 60.
    // Если бы peek-попадание тратило бюджет, на последнюю из 61 игры бюджета
    // бы не хватило и она пришла бы enriched:false. Раз бюджет не тратится —
    // хватает на все 61 (1 из кеша + 60 свежих), и enriched:false нет ни у кого.
    const games = library(62);
    const cachedAppId = games[1].appid; // первая игра второй полосы при topN=1
    fakeCache.set(`gameprice:v1:${cachedAppId}`, {
      rub: 500,
      isFree: false,
      source: "ru",
      genres: [],
    });

    const { enrichGames } = await import("@/lib/steam/enrich");
    const result = await enrichGames(games, 1);

    const cachedGame = result.find((g) => g.appid === cachedAppId);
    expect(cachedGame?.price).toBe(500);
    expect(cachedGame?.priceSource).toBe("ru");
    expect(result.filter((g) => g.enriched === false)).toHaveLength(0);
  }, 120_000);

  it("игра, до которой не хватило бюджета, приходит без цены и enriched:false — экономика считает её оценённой", async () => {
    // 1 топ-игра + 61 игра второй полосы на холодном кеше, бюджет — 60:
    // ровно одной игре свежего похода в магазин не достанется.
    const games = library(62);

    const { enrichGames } = await import("@/lib/steam/enrich");
    const result = await enrichGames(games, 1);

    const budgetLess = result.filter((g) => g.enriched === false);
    expect(budgetLess).toHaveLength(1);
    expect(budgetLess[0].price).toBeUndefined();
    expect(budgetLess[0].priceSource).toBeUndefined();

    const { buildAggregatedProfile } = await import("@/lib/aggregation/aggregate");
    const profile = buildAggregatedProfile(player(), result, noRecent, 10, [], noBadges, noAchievements);
    expect(profile.economics.estimatedGames).toBe(1);
  }, 120_000);
});
