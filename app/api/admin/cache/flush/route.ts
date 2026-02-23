import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";

export async function POST(req: Request) {
  // Simple auth via secret token
  const { token } = (await req.json().catch(() => ({}))) as { token?: string };
  const secret = process.env.ADMIN_SECRET;

  if (!secret || token !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !redisToken) {
    return NextResponse.json({ error: "Redis not configured" }, { status: 500 });
  }

  const redis = new Redis({ url, token: redisToken });
  await redis.flushdb();

  // Clear in-memory cache too
  const globalCache = globalThis as unknown as {
    __steamPsychoCache?: Map<string, unknown>;
  };
  if (globalCache.__steamPsychoCache) {
    globalCache.__steamPsychoCache.clear();
  }

  console.log("[admin] Cache flushed");
  return NextResponse.json({ success: true, message: "All cache flushed" });
}
