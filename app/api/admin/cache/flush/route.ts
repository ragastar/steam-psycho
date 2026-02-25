import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const { token } = (await req.json().catch(() => ({}))) as { token?: string };
  const secret = process.env.ADMIN_SECRET;

  if (!secret || token !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Try Redis if configured
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  let redisCleared = false;

  if (url && redisToken) {
    try {
      const { Redis } = await import("@upstash/redis");
      const redis = new Redis({ url, token: redisToken });
      await redis.flushdb();
      redisCleared = true;
    } catch (err) {
      console.warn("[admin] Redis flush failed:", err);
    }
  }

  // Clear in-memory cache
  const globalCache = globalThis as unknown as {
    __steamPsychoCache?: Map<string, unknown>;
  };
  if (globalCache.__steamPsychoCache) {
    globalCache.__steamPsychoCache.clear();
  }

  console.log("[admin] Cache flushed (redis:", redisCleared, ", memory: true)");
  return NextResponse.json({
    success: true,
    message: `Cache flushed (redis: ${redisCleared}, memory: true)`,
  });
}
