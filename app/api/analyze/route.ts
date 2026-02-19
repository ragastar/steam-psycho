import { NextResponse } from "next/server";
import { resolveToSteamId64, getPlayerSummary, getOwnedGames, getRecentlyPlayedGames, getSteamLevel } from "@/lib/steam/client";
import { enrichGames } from "@/lib/steam/enrich";
import { buildAggregatedProfile } from "@/lib/aggregation/aggregate";
import { generatePortrait, type LLMProvider } from "@/lib/llm/client";
import { SteamApiError } from "@/lib/steam/types";
import { getCache, setCache, incrementRateLimit } from "@/lib/cache/redis";
import { CACHE_TTL, portraitKey, profileKey, rateLimitKey } from "@/lib/cache/keys";

const ERROR_CODES: Record<string, number> = {
  INVALID_INPUT: 400,
  PROFILE_NOT_FOUND: 404,
  PRIVATE_PROFILE: 403,
  EMPTY_LIBRARY: 400,
  STEAM_UNAVAILABLE: 502,
  RATE_LIMITED: 429,
};

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
    const steamId64 = await resolveToSteamId64(input);

    // 2. Check cache for existing portrait
    const cachedPortrait = await getCache(portraitKey(steamId64, locale));
    if (cachedPortrait) {
      return NextResponse.json({ steamId64, cached: true });
    }

    // 3. Fetch player data
    const [player, games, recentGames, level] = await Promise.all([
      getPlayerSummary(steamId64),
      getOwnedGames(steamId64),
      getRecentlyPlayedGames(steamId64),
      getSteamLevel(steamId64),
    ]);

    // 4. Enrich with tags
    const enrichedGames = await enrichGames(games);

    // 5. Aggregate profile
    const profile = buildAggregatedProfile(player, enrichedGames, recentGames, level);

    // 6. Generate portrait via LLM
    const portrait = await generatePortrait(profile, locale, provider);

    // 7. Cache results
    await Promise.all([
      setCache(portraitKey(steamId64, locale), portrait, CACHE_TTL.portrait),
      setCache(profileKey(steamId64), profile, CACHE_TTL.aggregatedProfile),
    ]);

    return NextResponse.json({ steamId64, cached: false });
  } catch (err) {
    if (err instanceof SteamApiError) {
      return NextResponse.json(
        { error: true, code: err.code, message: err.message },
        { status: ERROR_CODES[err.code] || 500 },
      );
    }

    if (err instanceof Error && err.message === "INVALID_INPUT") {
      return NextResponse.json(
        { error: true, code: "INVALID_INPUT", message: "Invalid input format" },
        { status: 400 },
      );
    }

    console.error("Analysis error:", err);
    return NextResponse.json(
      { error: true, code: "ANALYSIS_ERROR", message: "Analysis failed" },
      { status: 500 },
    );
  }
}
