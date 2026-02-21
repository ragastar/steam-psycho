import { NextResponse } from "next/server";
import { getCache } from "@/lib/cache/redis";
import { portraitKey } from "@/lib/cache/keys";
import type { CardPortrait } from "@/lib/llm/types";
import { buildImagePrompt } from "@/lib/art/prompt-builder";
import { generateArtImage } from "@/lib/art/image-client";

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

    const imagePrompt = buildImagePrompt(portrait);
    const result = await generateArtImage(steamId64, imagePrompt);

    return NextResponse.json(result);
  } catch (err) {
    console.error("Art generation error:", err);
    return NextResponse.json({ error: "Art generation failed" }, { status: 500 });
  }
}
