import { Redis } from "@upstash/redis";

let redis: Redis | null = null;

// In-memory fallback when Redis is not configured
// Using globalThis to share cache across SSR and API routes in the same process
const globalCache = globalThis as unknown as {
  __steamPsychoCache?: Map<string, { value: unknown; expiresAt: number }>;
};
if (!globalCache.__steamPsychoCache) {
  globalCache.__steamPsychoCache = new Map();
}
const memoryCache = globalCache.__steamPsychoCache;

function getRedis(): Redis | null {
  if (redis) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  redis = new Redis({ url, token });
  return redis;
}

function memGet<T>(key: string): T | null {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memoryCache.delete(key);
    return null;
  }
  return entry.value as T;
}

function memSet(key: string, value: unknown, ttlSeconds: number): void {
  memoryCache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

export async function cached<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  // Try Redis first
  const r = getRedis();
  if (r) {
    try {
      const existing = await r.get<T>(key);
      if (existing !== null && existing !== undefined) return existing;
    } catch {
      // fall through
    }
  }

  // Try memory cache
  const memResult = memGet<T>(key);
  if (memResult !== null) return memResult;

  const fresh = await fetcher();

  // Store in both
  if (r) {
    try {
      await r.set(key, fresh, { ex: ttlSeconds });
    } catch {
      // ignore
    }
  }
  memSet(key, fresh, ttlSeconds);

  return fresh;
}

export async function setCache<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  memSet(key, value, ttlSeconds);

  const r = getRedis();
  if (!r) return;
  try {
    await r.set(key, value, { ex: ttlSeconds });
  } catch {
    // ignore
  }
}

export async function getCache<T>(key: string): Promise<T | null> {
  // Try memory first (faster)
  const memResult = memGet<T>(key);
  if (memResult !== null) return memResult;

  const r = getRedis();
  if (!r) return null;
  try {
    const result = await r.get<T>(key);
    if (result !== null && result !== undefined) {
      memSet(key, result, 3600); // cache in memory too
    }
    return result;
  } catch {
    return null;
  }
}

export async function incrementRateLimit(key: string, ttlSeconds: number): Promise<number> {
  const r = getRedis();
  if (r) {
    try {
      const count = await r.incr(key);
      if (count === 1) {
        await r.expire(key, ttlSeconds);
      }
      return count;
    } catch {
      // fall through to memory
    }
  }

  // Memory fallback for rate limiting
  const existing = memGet<number>(key);
  const newCount = (existing || 0) + 1;
  memSet(key, newCount, ttlSeconds);
  return newCount;
}
