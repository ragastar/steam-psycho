import { NextResponse } from "next/server";
import { getCache, incrementRateLimit } from "@/lib/cache/redis";
import { portraitKey, rateLimitKey, CACHE_TTL } from "@/lib/cache/keys";
import type { CardPortrait } from "@/lib/llm/types";
import { buildImagePrompt } from "@/lib/art/prompt-builder";
import { generateArtImage, artFileExists } from "@/lib/art/image-client";
import type { Element } from "@/lib/art/card-identity";
import { logArtGeneration, logError } from "@/lib/analytics/db";
import { getClientIp } from "@/lib/http/client-ip";
import { getAccessLevel } from "@/lib/access/entitlement";

interface CardIdentity {
  creature: string;
  element: Element;
}

export async function POST(req: Request) {
  try {
    const { steamId64, locale = "ru" } = await req.json();

    if (!steamId64 || typeof steamId64 !== "string") {
      return NextResponse.json({ error: "steamId64 required" }, { status: 400 });
    }

    // Картинка — платный контент, как и портрет.
    if ((await getAccessLevel(steamId64)) !== "full") {
      return NextResponse.json({ error: "Картинка ещё не открыта" }, { status: 403 });
    }

    // Уже готовое отдаём сразу: не тратим ни лимит, ни деньги.
    if (artFileExists(steamId64)) {
      const portrait = await getCache<CardPortrait>(portraitKey(steamId64, locale));
      logArtGeneration({ steamId64, cached: true });
      return NextResponse.json({
        imageUrl: `/api/art/image/${steamId64}`,
        prompt: portrait ? buildImagePrompt(portrait, "arcane") : "",
        cached: true,
      });
    }

    // Раньше здесь лимита не было вообще, хотя каждый вызов стоит денег.
    const ip = getClientIp(req);
    const count = await incrementRateLimit(rateLimitKey(`art:${ip}`), CACHE_TTL.rateLimit);
    const limit = parseInt(process.env.ART_RATE_LIMIT_PER_HOUR || "10", 10);
    if (count > limit) {
      return NextResponse.json(
        { error: "Слишком много запросов, попробуй позже" },
        { status: 429 },
      );
    }

    const portrait = await getCache<CardPortrait>(portraitKey(steamId64, locale));
    if (!portrait) {
      return NextResponse.json({ error: "Portrait not found" }, { status: 404 });
    }

    // Get algorithmically selected element (creature now comes from portrait)
    const identity = await getCache<CardIdentity>(`art:identity:${steamId64}`);
    const element: Element = identity?.element || "arcane";

    const imagePrompt = buildImagePrompt(portrait, element);
    const result = await generateArtImage(steamId64, imagePrompt);
    logArtGeneration({ steamId64, cached: result.cached });

    return NextResponse.json(result);
  } catch (err) {
    console.error("Art generation error:", err);
    logError({ type: "ART_ERROR", message: err instanceof Error ? err.message : "Unknown", endpoint: "/api/art/generate" });
    return NextResponse.json({ error: "Art generation failed" }, { status: 500 });
  }
}
