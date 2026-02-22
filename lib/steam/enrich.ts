import type { OwnedGame, EnrichedGame, SteamSpyAppData } from "./types";
import { cached } from "../cache/redis";

const STEAMSPY_BASE = "https://steamspy.com/api.php";
const STORE_BASE = "https://store.steampowered.com/api";
const DELAY_MS = 300;

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

/** Parse SteamSpy price string (cents) to dollars */
function parseSteamSpyPrice(spyData: SteamSpyAppData | null): number | undefined {
  if (!spyData?.initialprice) return undefined;
  const cents = parseInt(spyData.initialprice, 10);
  if (isNaN(cents) || cents <= 0) return undefined;
  return cents / 100;
}

interface StoreEnrichResult {
  genres: string[];
  price: number | undefined;
  isFree: boolean;
}

async function fetchStoreData(appId: number): Promise<StoreEnrichResult> {
  return cached(`steam:store:${appId}`, 7 * 24 * 3600, async () => {
    try {
      const res = await fetch(`${STORE_BASE}/appdetails?appids=${appId}&l=english`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return { genres: [], price: undefined, isFree: false };
      const data = await res.json();
      const appData = data[String(appId)];
      if (!appData?.success) return { genres: [], price: undefined, isFree: false };
      const genres = appData.data?.genres?.map((g: { description: string }) => g.description) || [];
      const isFree = appData.data?.is_free === true;
      const priceData = appData.data?.price_overview;
      const price = priceData ? priceData.final / 100 : undefined;
      return { genres, price, isFree };
    } catch {
      return { genres: [], price: undefined, isFree: false };
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

  const enriched: EnrichedGame[] = [];

  for (const game of topGames) {
    // Single SteamSpy request for tags + price + avg playtime
    const [spyData, storeData] = await Promise.all([
      fetchSteamSpyAppData(game.appid),
      fetchStoreData(game.appid),
    ]);

    const tags = spyData?.tags || {};
    // Store price preferred, SteamSpy initialprice as fallback
    const price = storeData.price ?? parseSteamSpyPrice(spyData);
    const isFree = storeData.isFree || (spyData?.initialprice === "0" && !price);

    enriched.push({
      ...game,
      tags,
      genres: storeData.genres,
      price,
      isFree,
      averageForever: spyData?.average_forever,
    });

    await delay(DELAY_MS);
  }

  // Remaining games: fetch only SteamSpy for price (no Store API — saves time)
  const remaining = sorted.slice(topN);
  const BATCH_SIZE = 5;
  for (let i = 0; i < remaining.length; i += BATCH_SIZE) {
    const batch = remaining.slice(i, i + BATCH_SIZE);
    const spyResults = await Promise.all(
      batch.map((game) => fetchSteamSpyAppData(game.appid)),
    );

    for (let j = 0; j < batch.length; j++) {
      const game = batch[j];
      const spyData = spyResults[j];
      const price = parseSteamSpyPrice(spyData);
      const isFree = spyData?.initialprice === "0" && !price;

      enriched.push({
        ...game,
        tags: {},
        genres: [],
        price,
        isFree,
        averageForever: spyData?.average_forever,
      });
    }

    if (i + BATCH_SIZE < remaining.length) {
      await delay(DELAY_MS);
    }
  }

  return enriched;
}
