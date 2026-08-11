import type { OwnedGame, EnrichedGame, SteamSpyAppData } from "./types";
import { cached } from "../cache/redis";
import { getGamePrice } from "@/lib/wealth/store-price";

const STEAMSPY_BASE = "https://steamspy.com/api.php";
const DELAY_MS = 300;

/**
 * Потолок на число игр, по которым мы вообще ходим за данными.
 *
 * Раньше предела не было: библиотека на 45 000 игр (такие реально есть) — это
 * 9000 пачек по 300 мс, то есть 45 минут одних пауз плюс 45 000 запросов к
 * стороннему сервису. Пользователь отваливался по таймауту, а сервер продолжал
 * молотить. Игры сверх потолка попадают в статистику по количеству и часам,
 * но без цен и тегов — на итоговый портрет это почти не влияет.
 */
const MAX_ENRICHED = 300;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchSteamSpyAppData(appId: number): Promise<SteamSpyAppData | null> {
  return cached(`steam:spy:${appId}`, 7 * 24 * 3600, async () => {
    try {
      const res = await fetch(`${STEAMSPY_BASE}?request=appdetails&appid=${appId}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  });
}

export async function enrichGames(
  games: OwnedGame[],
  topN: number = 30,
): Promise<EnrichedGame[]> {
  // Sort by playtime, take top N for full enrichment (tags, genres, store prices)
  const sorted = [...games].sort((a, b) => b.playtime_forever - a.playtime_forever);
  const topGames = sorted.slice(0, topN);

  // Process top games in parallel batches of 5 (instead of sequential)
  const BATCH_SIZE = 5;
  const enriched: EnrichedGame[] = [];

  for (let i = 0; i < topGames.length; i += BATCH_SIZE) {
    const batch = topGames.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (game) => {
        // Жанры и цена — из одного и того же похода в магазин (getGamePrice
        // отдаёт их вместе), отдельный запрос за жанрами не нужен.
        const [spyData, price] = await Promise.all([
          fetchSteamSpyAppData(game.appid),
          getGamePrice(game.appid),
        ]);
        const tags = spyData?.tags || {};
        return {
          ...game,
          tags,
          genres: price.genres,
          price: price.rub,
          isFree: price.isFree,
          priceSource: price.source,
          enriched: true,
          averageForever: spyData?.average_forever,
        } as EnrichedGame;
      }),
    );
    enriched.push(...batchResults);

    if (i + BATCH_SIZE < topGames.length) {
      await delay(DELAY_MS);
    }
  }

  // Остальные до потолка: тегов и жанров нет (это привилегия топ-N), но цена —
  // из того же getGamePrice, что и у топ-игр: единая база, второй источник денег
  // не заводим.
  const remaining = sorted.slice(topN, MAX_ENRICHED);
  for (let i = 0; i < remaining.length; i += BATCH_SIZE) {
    const batch = remaining.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (game) => {
        const [spyData, price] = await Promise.all([
          fetchSteamSpyAppData(game.appid),
          getGamePrice(game.appid),
        ]);
        return {
          ...game,
          tags: {},
          genres: [],
          price: price.rub,
          isFree: price.isFree,
          priceSource: price.source,
          enriched: true,
          averageForever: spyData?.average_forever,
        } as EnrichedGame;
      }),
    );
    enriched.push(...batchResults);

    if (i + BATCH_SIZE < remaining.length) {
      await delay(DELAY_MS);
    }
  }

  // Хвост сверх потолка проходит без запросов наружу: количество игр и часы
  // сохраняются, цен и тегов у них нет.
  const skipped = sorted.slice(MAX_ENRICHED);
  if (skipped.length > 0) {
    console.log(`[enrich] библиотека ${sorted.length} игр: обогащено ${MAX_ENRICHED}, пропущено ${skipped.length}`);
    for (const game of skipped) {
      enriched.push({ ...game, tags: {}, genres: [], enriched: false });
    }
  }

  return enriched;
}
