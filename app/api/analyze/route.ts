import { NextResponse } from "next/server";
import {
  resolveToSteamId64,
  getPlayerSummary,
  getOwnedGames,
  getRecentlyPlayedGames,
  getSteamLevel,
  getFriendList,
  getBadges,
  getPlayerAchievements,
  getGlobalAchievementPercentages,
} from "@/lib/steam/client";
import { enrichGames } from "@/lib/steam/enrich";
import { buildAggregatedProfile, calculateCardStats, calculateRarity } from "@/lib/aggregation/aggregate";
import { generatePortrait, type LLMProvider } from "@/lib/llm/client";
import { SteamApiError } from "@/lib/steam/types";
import type { AchievementGameData, OwnedGame } from "@/lib/steam/types";
import { getCache, setCache, incrementRateLimit } from "@/lib/cache/redis";
import { CACHE_TTL, portraitKey, profileKey, rateLimitKey } from "@/lib/cache/keys";
import { selectCardIdentity } from "@/lib/art/card-identity";
import { logAnalysis, logError } from "@/lib/analytics/db";
import { hashIp } from "@/lib/analytics/hash";

const ERROR_CODES: Record<string, number> = {
  INVALID_INPUT: 400,
  PROFILE_NOT_FOUND: 404,
  PRIVATE_PROFILE: 403,
  EMPTY_LIBRARY: 400,
  HIDDEN_LIBRARY: 403,
  FEW_GAMES: 400,
  NO_PLAYTIME: 403,
  STEAM_UNAVAILABLE: 502,
  RATE_LIMITED: 429,
};

async function fetchAchievementsForTopGames(
  steamId64: string,
  games: { appid: number; name: string }[],
): Promise<AchievementGameData[]> {
  const results: AchievementGameData[] = [];
  // Fetch for top 10 games, graceful failure
  const topGames = games.slice(0, 10);

  for (const game of topGames) {
    try {
      const [achievements, globalAchievements] = await Promise.all([
        getPlayerAchievements(steamId64, game.appid),
        getGlobalAchievementPercentages(game.appid),
      ]);
      if (achievements.length > 0) {
        results.push({
          appid: game.appid,
          name: game.name,
          achievements,
          globalAchievements,
        });
      }
    } catch {
      // Graceful: skip this game
    }
  }

  return results;
}

export async function POST(req: Request) {
  try {
    // Rate limiting
    const forwarded = req.headers.get("x-forwarded-for");
    const ip = forwarded?.split(",")[0]?.trim() || "unknown";
    const rateLimitCount = await incrementRateLimit(rateLimitKey(ip), CACHE_TTL.rateLimit);
    const rateLimit = parseInt(process.env.RATE_LIMIT_PER_HOUR || "30", 10);
    if (rateLimitCount > rateLimit) {
      return NextResponse.json(
        { error: true, code: "RATE_LIMITED", message: "Too many requests" },
        { status: 429 },
      );
    }

    const body = await req.json();
    const { input, locale = "ru", provider } = body as {
      input: string;
      locale?: string;
      provider?: LLMProvider;
    };

    if (!input || typeof input !== "string") {
      return NextResponse.json(
        { error: true, code: "INVALID_INPUT", message: "Input is required" },
        { status: 400 },
      );
    }

    // 1. Resolve SteamID64
    const t0 = Date.now();
    const steamId64 = await resolveToSteamId64(input);
    console.log(`[analyze] ${steamId64} resolve: ${Date.now() - t0}ms`);

    // 2. Check cache for existing portrait
    const ipHash = hashIp(ip);

    const cachedPortrait = await getCache(portraitKey(steamId64, locale));
    if (cachedPortrait) {
      logAnalysis({ steamId64, locale, cached: true, ipHash });
      console.log(`[analyze] ${steamId64} HIT cache, total: ${Date.now() - t0}ms`);
      return NextResponse.json({ steamId64, cached: true });
    }

    // 3. Fetch player data (parallel)
    // Critical calls (player, games) throw on failure; non-critical ones gracefully degrade
    const t1 = Date.now();
    const [player, games, recentGames, level, friends, badgesResponse] = await Promise.all([
      getPlayerSummary(steamId64),
      getOwnedGames(steamId64),
      getRecentlyPlayedGames(steamId64).catch(() => [] as OwnedGame[]),
      getSteamLevel(steamId64).catch(() => 0),
      getFriendList(steamId64),
      getBadges(steamId64),
    ]);
    console.log(`[analyze] ${steamId64} steam API: ${Date.now() - t1}ms`);

    // 3.5 Check for hidden library
    if (!games || games.length === 0) {
      return NextResponse.json(
        { error: true, code: "HIDDEN_LIBRARY", message: "Game library is hidden" },
        { status: 403 },
      );
    }

    // 3.6 Check for too few games
    if (games.length < 5) {
      return NextResponse.json(
        { error: true, code: "FEW_GAMES", message: "Not enough games for analysis (minimum 5)" },
        { status: 400 },
      );
    }

    // 3.7 Check for all games having zero playtime (partial privacy)
    const gamesWithPlaytime = games.filter((g) => g.playtime_forever > 0);
    if (gamesWithPlaytime.length === 0) {
      return NextResponse.json(
        { error: true, code: "NO_PLAYTIME", message: "All games have zero playtime — likely privacy settings" },
        { status: 403 },
      );
    }

    // 4. Enrich with tags + prices
    const t2 = Date.now();
    const enrichedGames = await enrichGames(games);
    console.log(`[analyze] ${steamId64} enrich: ${Date.now() - t2}ms`);

    // 5. Fetch achievements for top games
    const t3 = Date.now();
    const sortedGames = [...enrichedGames].sort((a, b) => b.playtime_forever - a.playtime_forever);
    const achievementsData = await fetchAchievementsForTopGames(
      steamId64,
      sortedGames.slice(0, 10).map((g) => ({ appid: g.appid, name: g.name })),
    );
    console.log(`[analyze] ${steamId64} achievements: ${Date.now() - t3}ms`);

    // 6. Aggregate profile
    const profile = buildAggregatedProfile(
      player,
      enrichedGames,
      recentGames,
      level,
      friends,
      badgesResponse,
      achievementsData,
    );

    // 7. Calculate card stats and rarity
    const cardStats = calculateCardStats(profile);
    const rarity = calculateRarity(profile);

    // 8. Select card identity (creature + element) algorithmically
    const cardIdentity = selectCardIdentity(profile, cardStats, steamId64);

    // 9. Generate portrait via LLM (creature chosen freely by LLM, element stays algorithmic)
    const t4 = Date.now();
    const portrait = await generatePortrait(profile, cardStats, rarity, locale, provider);
    console.log(`[analyze] ${steamId64} LLM: ${Date.now() - t4}ms`);

    // 10. Cache results
    await Promise.all([
      setCache(portraitKey(steamId64, locale), portrait, CACHE_TTL.portrait),
      setCache(profileKey(steamId64), profile, CACHE_TTL.aggregatedProfile),
      setCache(`art:identity:${steamId64}`, cardIdentity, CACHE_TTL.portrait),
    ]);

    console.log(`[analyze] ${steamId64} TOTAL: ${Date.now() - t0}ms`);

    logAnalysis({
      steamId64, locale, cached: false, ipHash,
      rarity,
      stats: cardStats,
      primaryArchetype: portrait.primaryArchetype?.name,
      spiritAnimal: portrait.spirit_animal?.name,
      element: cardIdentity.element,
      librarySize: games.length,
      totalPlaytimeHours: games.reduce((s, g) => s + g.playtime_forever, 0) / 60,
      accountAgeYears: profile.timeline?.accountAge,
      llmProvider: provider || process.env.LLM_PROVIDER || "openai",
    });

    return NextResponse.json({ steamId64, cached: false });
  } catch (err) {
    const forwarded2 = req.headers.get("x-forwarded-for");
    const errIp = forwarded2?.split(",")[0]?.trim() || "unknown";
    const errIpHash = hashIp(errIp);

    if (err instanceof SteamApiError) {
      logError({ type: err.code, message: err.message, ipHash: errIpHash, endpoint: "/api/analyze" });
      return NextResponse.json(
        { error: true, code: err.code, message: err.message },
        { status: ERROR_CODES[err.code] || 500 },
      );
    }

    if (err instanceof Error && err.message === "INVALID_INPUT") {
      logError({ type: "INVALID_INPUT", message: "Invalid input format", ipHash: errIpHash, endpoint: "/api/analyze" });
      return NextResponse.json(
        { error: true, code: "INVALID_INPUT", message: "Invalid input format" },
        { status: 400 },
      );
    }

    console.error("Analysis error:", err);
    logError({ type: "ANALYSIS_ERROR", message: err instanceof Error ? err.message : "Unknown", ipHash: errIpHash, endpoint: "/api/analyze" });
    return NextResponse.json(
      { error: true, code: "ANALYSIS_ERROR", message: "Analysis failed" },
      { status: 500 },
    );
  }
}
