import type { OwnedGame, EnrichedGame, SteamSpyAppData } from "./types";
import { cached } from "../cache/redis";

const STEAMSPY_BASE = "https://steamspy.com/api.php";
const STORE_BASE = "https://store.steampowered.com/api";
const DELAY_MS = 300;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchSteamSpyTags(appId: number): Promise<Record<string, number>> {
  return cached(`steam:tags:${appId}`, 7 * 24 * 3600, async () => {
    try {
      const res = await fetch(`${STEAMSPY_BASE}?request=appdetails&appid=${appId}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return {};
      const data: SteamSpyAppData = await res.json();
      return data.tags || {};
    } catch {
      return {};
    }
  });
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
  // Sort by playtime, take top N
  const sorted = [...games].sort((a, b) => b.playtime_forever - a.playtime_forever);
  const topGames = sorted.slice(0, topN);

  const enriched: EnrichedGame[] = [];

  for (const game of topGames) {
    const [tags, storeData, spyData] = await Promise.all([
      fetchSteamSpyTags(game.appid),
      fetchStoreData(game.appid),
      fetchSteamSpyAppData(game.appid),
    ]);

    enriched.push({
      ...game,
      tags,
      genres: storeData.genres,
      price: storeData.price,
      isFree: storeData.isFree,
      averageForever: spyData?.average_forever,
    });

    await delay(DELAY_MS);
  }

  // Add remaining games without enrichment
  const remainingGames = sorted.slice(topN).map((game) => ({
    ...game,
    tags: {},
    genres: [],
    price: undefined,
    isFree: false,
    averageForever: undefined,
  }));

  return [...enriched, ...remainingGames];
}
