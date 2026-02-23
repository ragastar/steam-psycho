import { NextResponse } from "next/server";
import { getCache } from "@/lib/cache/redis";
import { portraitKey } from "@/lib/cache/keys";
import type { CardPortrait } from "@/lib/llm/types";
import { buildImagePrompt } from "@/lib/art/prompt-builder";
import { generateArtImage } from "@/lib/art/image-client";
import type { Element } from "@/lib/art/card-identity";
import { logArtGeneration, logError } from "@/lib/analytics/db";

interface CardIdentity {
  creature: string;
  element: Element;
}

export async function POST(req: Request) {
  try {
    const { steamId64, locale = "ru" } = await req.json();

    if (!steamId64) {
      return NextResponse.json({ error: "steamId64 required" }, { status: 400 });
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
    logArtGeneration({ steamId64, cached: false });

    return NextResponse.json(result);
  } catch (err) {
    console.error("Art generation error:", err);
    logError({ type: "ART_ERROR", message: err instanceof Error ? err.message : "Unknown", endpoint: "/api/art/generate" });
    return NextResponse.json({ error: "Art generation failed" }, { status: 500 });
  }
}
