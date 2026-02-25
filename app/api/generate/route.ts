import { NextResponse } from "next/server";
import { generatePortrait } from "@/lib/llm/client";
import { getCache, setCache, incrementRateLimit } from "@/lib/cache/redis";
import { CACHE_TTL, portraitKey, profileKey, cardStatsKey, rarityKey, rateLimitKey } from "@/lib/cache/keys";
import { selectCardIdentity } from "@/lib/art/card-identity";
import { logAnalysis, logError } from "@/lib/analytics/db";
import { hashIp } from "@/lib/analytics/hash";
import type { AggregatedProfile } from "@/lib/aggregation/types";
import type { CardStats } from "@/lib/aggregation/aggregate";
import type { Rarity } from "@/lib/llm/types";

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
    const { steamId64, locale = "ru" } = body as {
      steamId64: string;
      locale?: string;
    };

    if (!steamId64 || typeof steamId64 !== "string") {
      return NextResponse.json(
        { error: true, code: "INVALID_INPUT", message: "steamId64 is required" },
        { status: 400 },
      );
    }

    const ipHash = hashIp(ip);

    // 1. Check if portrait already cached
    const cachedPortrait = await getCache(portraitKey(steamId64, locale));
    if (cachedPortrait) {
      console.log(`[generate] ${steamId64} portrait already cached`);
      return NextResponse.json({ status: "ready" });
    }

    // 2. Load profile data from cache
    const [profile, cardStats, rarity] = await Promise.all([
      getCache<AggregatedProfile>(profileKey(steamId64)),
      getCache<CardStats>(cardStatsKey(steamId64)),
      getCache<Rarity>(rarityKey(steamId64)),
    ]);

    if (!profile || !cardStats || !rarity) {
      return NextResponse.json(
        { error: true, code: "DATA_EXPIRED", message: "Profile data expired. Please re-analyze." },
        { status: 410 },
      );
    }

    // 3. Generate portrait via LLM
    const t0 = Date.now();
    const portrait = await generatePortrait(profile, cardStats, rarity, locale);
    console.log(`[generate] ${steamId64} LLM: ${Date.now() - t0}ms`);

    // 4. Load card identity (cached during analyze)
    const cardIdentity = await getCache<{ element: string }>(`art:identity:${steamId64}`)
      || selectCardIdentity(profile, cardStats, steamId64);

    // 5. Cache portrait
    await setCache(portraitKey(steamId64, locale), portrait, CACHE_TTL.portrait);

    logAnalysis({
      steamId64, locale, cached: false, ipHash,
      rarity,
      stats: cardStats,
      primaryArchetype: portrait.primaryArchetype?.name,
      spiritAnimal: portrait.spirit_animal?.name,
      element: cardIdentity.element,
      librarySize: profile.stats.totalGames,
      totalPlaytimeHours: profile.stats.totalPlaytimeHours,
      accountAgeYears: profile.timeline?.accountAge,
      llmProvider: process.env.LLM_PROVIDER || "openai",
    });

    return NextResponse.json({ status: "generated" });
  } catch (err) {
    console.error("[generate] error:", err);
    const forwarded2 = req.headers.get("x-forwarded-for");
    const errIp = forwarded2?.split(",")[0]?.trim() || "unknown";
    logError({
      type: "GENERATE_ERROR",
      message: err instanceof Error ? err.message : "Unknown",
      ipHash: hashIp(errIp),
      endpoint: "/api/generate",
    });
    return NextResponse.json(
      { error: true, code: "GENERATE_ERROR", message: "Portrait generation failed" },
      { status: 500 },
    );
  }
}
