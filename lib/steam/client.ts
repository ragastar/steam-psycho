import type { SteamPlayer, OwnedGame } from "./types";
import { SteamApiError } from "./types";
import { parseInput } from "./resolve";

const STEAM_API_BASE = "https://api.steampowered.com";
const FETCH_TIMEOUT = 10000;

function getApiKey(): string {
  const key = process.env.STEAM_API_KEY;
  if (!key) throw new Error("STEAM_API_KEY is not set");
  return key;
}

async function steamFetch<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      if (res.status === 429) throw new SteamApiError("Rate limited", "RATE_LIMITED");
      throw new SteamApiError("Steam API unavailable", "STEAM_UNAVAILABLE");
    }
    return await res.json();
  } catch (err) {
    if (err instanceof SteamApiError) throw err;
    if ((err as Error).name === "AbortError") {
      throw new SteamApiError("Steam API timeout", "STEAM_UNAVAILABLE");
    }
    throw new SteamApiError("Steam API unavailable", "STEAM_UNAVAILABLE");
  } finally {
    clearTimeout(timeout);
  }
}

export async function resolveToSteamId64(input: string): Promise<string> {
  const parsed = parseInput(input);

  if (parsed.type === "profileUrl" || parsed.type === "steamId64") {
    return parsed.value;
  }

  // Vanity URL or vanity name -> resolve via API
  const key = getApiKey();
  const url = `${STEAM_API_BASE}/ISteamUser/ResolveVanityURL/v1/?key=${key}&vanityurl=${encodeURIComponent(parsed.value)}`;
  const data = await steamFetch<{ response: { success: number; steamid?: string } }>(url);

  if (data.response.success !== 1 || !data.response.steamid) {
    throw new SteamApiError("Profile not found", "PROFILE_NOT_FOUND");
  }

  return data.response.steamid;
}

export async function getPlayerSummary(steamId64: string): Promise<SteamPlayer> {
  const key = getApiKey();
  const url = `${STEAM_API_BASE}/ISteamUser/GetPlayerSummaries/v2/?key=${key}&steamids=${steamId64}`;
  const data = await steamFetch<{ response: { players: SteamPlayer[] } }>(url);

  const player = data.response.players[0];
  if (!player) {
    throw new SteamApiError("Profile not found", "PROFILE_NOT_FOUND");
  }

  if (player.communityvisibilitystate !== 3) {
    throw new SteamApiError("Profile is private", "PRIVATE_PROFILE");
  }

  return player;
}

export async function getOwnedGames(steamId64: string): Promise<OwnedGame[]> {
  const key = getApiKey();
  const url = `${STEAM_API_BASE}/IPlayerService/GetOwnedGames/v1/?key=${key}&steamid=${steamId64}&include_appinfo=1&include_played_free_games=1`;
  const data = await steamFetch<{ response: { game_count?: number; games?: OwnedGame[] } }>(url);

  const games = data.response.games || [];
  if (games.length < 3) {
    throw new SteamApiError("Not enough games", "EMPTY_LIBRARY");
  }

  return games;
}

export async function getRecentlyPlayedGames(steamId64: string): Promise<OwnedGame[]> {
  const key = getApiKey();
  const url = `${STEAM_API_BASE}/IPlayerService/GetRecentlyPlayedGames/v1/?key=${key}&steamid=${steamId64}`;
  const data = await steamFetch<{ response: { games?: OwnedGame[] } }>(url);

  return data.response.games || [];
}

export async function getSteamLevel(steamId64: string): Promise<number> {
  const key = getApiKey();
  const url = `${STEAM_API_BASE}/IPlayerService/GetSteamLevel/v1/?key=${key}&steamid=${steamId64}`;
  const data = await steamFetch<{ response: { player_level?: number } }>(url);

  return data.response.player_level || 0;
}
