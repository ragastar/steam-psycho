import { Redis } from "@upstash/redis";
import { getDb } from "@/lib/analytics/db";

let redis: Redis | null = null;

// In-memory fallback when Redis is not configured
// Using globalThis to share cache across SSR and API routes in the same process
const globalCache = globalThis as unknown as {
  __steamPsychoCache?: Map<string, { value: unknown; expiresAt: number }>;
  __gateTableCreated?: boolean;
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

// --- SQLite persistence for gate tokens (survives container restarts) ---

function ensureGateTable(): void {
  if (globalCache.__gateTableCreated) return;
  try {
    const db = getDb();
    if (!db) return;
    db.exec(`
      CREATE TABLE IF NOT EXISTS gate_tokens (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      )
    `);
    globalCache.__gateTableCreated = true;
  } catch (err) {
    console.error("[cache] Failed to create gate_tokens table:", err);
  }
}

function sqliteGet<T>(key: string): T | null {
  try {
    ensureGateTable();
    const db = getDb();
    if (!db) return null;
    const row = db.prepare("SELECT value, expires_at FROM gate_tokens WHERE key = ?").get(key) as
      | { value: string; expires_at: number }
      | undefined;
    if (!row) return null;
    if (Date.now() > row.expires_at) {
      db.prepare("DELETE FROM gate_tokens WHERE key = ?").run(key);
      return null;
    }
    return JSON.parse(row.value) as T;
  } catch (err) {
    console.error("[cache] sqliteGet failed:", err);
    return null;
  }
}

function sqliteDelete(key: string): void {
  try {
    ensureGateTable();
    const db = getDb();
    if (!db) return;
    db.prepare("DELETE FROM gate_tokens WHERE key = ?").run(key);
  } catch (err) {
    console.error("[cache] sqliteDelete failed:", err);
  }
}

function sqliteSet(key: string, value: unknown, ttlSeconds: number): void {
  try {
    ensureGateTable();
    const db = getDb();
    if (!db) return;
    db.prepare(
      "INSERT OR REPLACE INTO gate_tokens (key, value, expires_at) VALUES (?, ?, ?)",
    ).run(key, JSON.stringify(value), Date.now() + ttlSeconds * 1000);
  } catch (err) {
    console.error("[cache] sqliteSet failed:", err);
  }
}

/**
 * Что переживает перезапуск контейнера.
 *
 * Внешний кеш не настроен, поэтому всё живёт в памяти процесса. Раньше в SQLite
 * писались только гейт-токены — и любой редеплой (а он идёт автоматически на
 * каждый push в master) стирал разобранные профили: все, кто в этот момент ждал
 * результат, получали «данные устарели, начните заново».
 */
/**
 * Цены и курс попали сюда 2026-08-12. Они не про конкретного человека, но
 * добываются дорого: разбор библиотеки укладывается в бюджет 60 новых походов
 * в магазин Steam, а магазин режет по частоте. Пока цены жили только в памяти,
 * каждая пересборка образа обнуляла их, и у аккаунта со 157 играми настоящую
 * цену получали 68, а 67 достраивались средней.
 *
 * Прайс-лист рынка (market:) сюда сознательно НЕ входит: это один большой
 * список на игру, ради которого хватает одного похода в сутки.
 */
export const PERSISTENT_PREFIXES = [
  "gate:", "profile:", "cardstats:", "rarity:", "portrait:", "art:identity:", "wealth:",
  "gameprice:", "storeprice:", "fx:",
];

export function isPersistentKey(key: string): boolean {
  return PERSISTENT_PREFIXES.some((p) => key.startsWith(p));
}

// --- Memory cache ---

const MAX_CACHE_SIZE = 5000;

function evictIfNeeded(): void {
  if (memoryCache.size <= MAX_CACHE_SIZE) return;

  // 1. Remove expired entries first
  const now = Date.now();
  const keysToCheck = Array.from(memoryCache.keys());
  for (const key of keysToCheck) {
    const entry = memoryCache.get(key);
    if (entry && now > entry.expiresAt) memoryCache.delete(key);
  }

  // 2. If still over limit, remove oldest 20%
  if (memoryCache.size > MAX_CACHE_SIZE) {
    const entries = Array.from(memoryCache.entries()).sort(
      (a, b) => a[1].expiresAt - b[1].expiresAt,
    );
    const toRemove = Math.ceil(entries.length * 0.2);
    for (let i = 0; i < toRemove; i++) {
      memoryCache.delete(entries[i][0]);
    }
  }
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
  evictIfNeeded();
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

  // Persist gate tokens to SQLite (survives container restarts)
  if (isPersistentKey(key)) {
    sqliteSet(key, value, ttlSeconds);
  }

  const r = getRedis();
  if (!r) return;
  try {
    await r.set(key, value, { ex: ttlSeconds });
  } catch {
    // ignore
  }
}

export async function deleteCache(key: string): Promise<void> {
  memoryCache.delete(key);

  // Тот же порядок, что у setCache/getCache: SQLite — только для ключей из
  // PERSISTENT_PREFIXES. login: в этот список не входит, а getDb() не
  // запоминает неудачу открытия базы — значит, безусловный вызов давал бы
  // по две проваленных попытки открыть SQLite и лог "Failed to open SQLite"
  // на каждый обмен токена.
  if (isPersistentKey(key)) {
    sqliteDelete(key);
  }

  const client = getRedis();
  if (client) await client.del(key);
}

export async function getCache<T>(key: string): Promise<T | null> {
  // Try memory first (faster)
  const memResult = memGet<T>(key);
  if (memResult !== null) return memResult;

  // For gate keys, check SQLite before Redis (persists across restarts)
  if (isPersistentKey(key)) {
    const sqlResult = sqliteGet<T>(key);
    if (sqlResult !== null) {
      memSet(key, sqlResult, 3600); // warm memory cache
      return sqlResult;
    }
  }

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
  //
  // Окно фиксированное: срок ставится при ПЕРВОМ инкременте и дальше не
  // двигается — так же, как в ветке Redis выше (expire только при count === 1).
  // Раньше здесь на каждый инкремент шёл memSet, и каждая новая попытка
  // отодвигала конец окна на час вперёд: исчерпанная корзина не опустошалась,
  // пока в неё стучится хоть кто-то чаще раза в час. Человек, следовавший
  // совету «подожди и попробуй снова», продлевал собственную блокировку.
  // Upstash не настроен, значит в проде работает именно эта ветка.
  const entry = memoryCache.get(key);
  if (!entry || Date.now() > entry.expiresAt) {
    memSet(key, 1, ttlSeconds);
    return 1;
  }
  // Значение правим на месте: expiresAt при этом остаётся прежним.
  const next = (typeof entry.value === "number" ? entry.value : 0) + 1;
  entry.value = next;
  return next;
}
