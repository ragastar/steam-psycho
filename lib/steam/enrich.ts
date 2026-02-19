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

async function fetchStoreGenres(appId: number): Promise<string[]> {
  return cached(`steam:genres:${appId}`, 7 * 24 * 3600, async () => {
    try {
      const res = await fetch(`${STORE_BASE}/appdetails?appids=${appId}&l=english`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return [];
      const data = await res.json();
      const appData = data[String(appId)];
      if (!appData?.success || !appData.data?.genres) return [];
      return appData.data.genres.map((g: { description: string }) => g.description);
    } catch {
      return [];
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
    const [tags, genres] = await Promise.all([
      fetchSteamSpyTags(game.appid),
      fetchStoreGenres(game.appid),
    ]);

    enriched.push({
      ...game,
      tags,
      genres,
    });

    await delay(DELAY_MS);
  }

  // Add remaining games without enrichment
  const remainingGames = sorted.slice(topN).map((game) => ({
    ...game,
    tags: {},
    genres: [],
  }));

  return [...enriched, ...remainingGames];
}
