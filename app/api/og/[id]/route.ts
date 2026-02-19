import { NextResponse } from "next/server";
import { getCache } from "@/lib/cache/redis";
import { portraitKey, profileKey } from "@/lib/cache/keys";
import { renderCardPng } from "@/lib/card/render";
import type { Portrait } from "@/lib/llm/types";
import type { AggregatedProfile } from "@/lib/aggregation/types";

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const url = new URL(req.url);
  const locale = url.searchParams.get("locale") || "ru";

  const [portrait, profile] = await Promise.all([
    getCache<Portrait>(portraitKey(params.id, locale)),
    getCache<AggregatedProfile>(profileKey(params.id)),
  ]);

  if (!portrait || !profile) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const png = await renderCardPng(portrait, profile);
    return new NextResponse(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        "Content-Disposition": `attachment; filename="steam-psycho-${params.id}.png"`,
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (err) {
    console.error("Card render error:", err);
    return NextResponse.json({ error: "Render failed" }, { status: 500 });
  }
}
