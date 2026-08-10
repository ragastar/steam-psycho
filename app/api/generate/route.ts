import { NextResponse } from "next/server";
import { generatePortrait } from "@/lib/llm/client";
import { applyComputedFacts } from "@/lib/llm/facts";
import { getCache, setCache, incrementRateLimit } from "@/lib/cache/redis";
import { CACHE_TTL, portraitKey, profileKey, cardStatsKey, rarityKey, rateLimitKey } from "@/lib/cache/keys";
import { selectCardIdentity } from "@/lib/art/card-identity";
import { logAnalysis, logError } from "@/lib/analytics/db";
import { hashIp } from "@/lib/analytics/hash";
import { getClientIp } from "@/lib/http/client-ip";
import { getAccessLevel } from "@/lib/access/entitlement";
import type { AggregatedProfile } from "@/lib/aggregation/types";
import type { CardStats } from "@/lib/aggregation/aggregate";
import type { Rarity } from "@/lib/llm/types";

export async function POST(req: Request) {
  const ip = getClientIp(req);

  try {
    // Rate limiting
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

    // Доступ проверяется ЗДЕСЬ, а не в компоненте перед вызовом.
    // Раньше эта точка генерировала платный портрет любому, кто знает Steam ID.
    if ((await getAccessLevel(steamId64)) !== "full") {
      return NextResponse.json(
        { error: true, code: "ACCESS_REQUIRED", message: "Портрет ещё не открыт" },
        { status: 403 },
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
    const generated = await generatePortrait(profile, cardStats, rarity, locale);
    console.log(`[generate] ${steamId64} LLM: ${Date.now() - t0}ms (${generated.provider}/${generated.model})`);

    // Числа берём свои: модель регулярно перевирает статы, которые ей дали.
    const portrait = applyComputedFacts(generated.portrait, cardStats, rarity);

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
      // Пишем то, что реально отработало, а не значение из настроек.
      llmProvider: `${generated.provider}/${generated.model}`,
    });

    return NextResponse.json({ status: "generated" });
  } catch (err) {
    console.error("[generate] error:", err);
    logError({
      type: "GENERATE_ERROR",
      message: err instanceof Error ? err.message : "Unknown",
      ipHash: hashIp(ip),
      endpoint: "/api/generate",
    });
    return NextResponse.json(
      { error: true, code: "GENERATE_ERROR", message: "Portrait generation failed" },
      { status: 500 },
    );
  }
}
