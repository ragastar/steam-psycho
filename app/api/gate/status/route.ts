import { NextResponse } from "next/server";
import { getCache } from "@/lib/cache/redis";
import { gateTokenKey } from "@/lib/cache/keys";

interface GateData {
  steamId64: string;
  locale: string;
  status: "pending" | "unlocked";
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");

  if (!token) {
    return NextResponse.json({ status: "expired" });
  }

  try {
    const data = await getCache<GateData>(gateTokenKey(token));

    if (!data) {
      return NextResponse.json({ status: "expired" });
    }

    return NextResponse.json({ status: data.status });
  } catch {
    // Graceful degradation: if Redis is down, unlock
    return NextResponse.json({ status: "unlocked" });
  }
}
