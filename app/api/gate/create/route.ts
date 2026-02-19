import { NextResponse } from "next/server";
import { setCache } from "@/lib/cache/redis";
import { CACHE_TTL, gateTokenKey } from "@/lib/cache/keys";
import crypto from "crypto";

export async function POST(req: Request) {
  try {
    const { steamId64, locale } = await req.json();

    if (!steamId64 || typeof steamId64 !== "string") {
      return NextResponse.json({ error: "steamId64 required" }, { status: 400 });
    }

    const token = crypto.randomUUID().replace(/-/g, "").slice(0, 16);

    await setCache(
      gateTokenKey(token),
      { steamId64, locale: locale || "ru", status: "pending" },
      CACHE_TTL.gate,
    );

    return NextResponse.json({ token });
  } catch {
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
