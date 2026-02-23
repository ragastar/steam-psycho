import { getDb } from "./db";

type Row = Record<string, unknown>;

function query<T = Row>(sql: string, params: unknown[] = []): T[] {
  const db = getDb();
  if (!db) return [];
  try {
    return db.prepare(sql).all(...params) as T[];
  } catch (err) {
    console.error("[analytics] Query failed:", err);
    return [];
  }
}

function queryOne<T = Row>(sql: string, params: unknown[] = []): T | null {
  const db = getDb();
  if (!db) return null;
  try {
    return (db.prepare(sql).get(...params) as T) || null;
  } catch (err) {
    console.error("[analytics] Query failed:", err);
    return null;
  }
}

// === Overview ===

export function getOverviewStats(periodMs: number = 24 * 60 * 60 * 1000) {
  const since = Date.now() - periodMs;

  const total = queryOne<{ count: number }>("SELECT COUNT(*) as count FROM analyses") ?? { count: 0 };
  const today = queryOne<{ count: number }>("SELECT COUNT(*) as count FROM analyses WHERE timestamp > ?", [since]) ?? { count: 0 };
  const unique = queryOne<{ count: number }>("SELECT COUNT(DISTINCT steam_id64) as count FROM analyses") ?? { count: 0 };
  const uniqueToday = queryOne<{ count: number }>("SELECT COUNT(DISTINCT steam_id64) as count FROM analyses WHERE timestamp > ?", [since]) ?? { count: 0 };
  const errors = queryOne<{ count: number }>("SELECT COUNT(*) as count FROM errors WHERE timestamp > ?", [since]) ?? { count: 0 };
  const totalRequests = (today.count || 0) + (errors.count || 0);
  const errorRate = totalRequests > 0 ? (errors.count / totalRequests * 100) : 0;
  const artTotal = queryOne<{ count: number }>("SELECT COUNT(*) as count FROM art_generations") ?? { count: 0 };
  const cacheHits = queryOne<{ count: number }>("SELECT COUNT(*) as count FROM analyses WHERE cached = 1") ?? { count: 0 };
  const cacheRate = total.count > 0 ? (cacheHits.count / total.count * 100) : 0;
  const gateUnlocks = queryOne<{ count: number }>("SELECT COUNT(*) as count FROM gate_events WHERE event = 'unlocked'") ?? { count: 0 };
  const avgPlaytime = queryOne<{ avg: number | null }>("SELECT AVG(total_playtime_hours) as avg FROM analyses WHERE total_playtime_hours IS NOT NULL AND cached = 0") ?? { avg: null };

  return {
    totalAnalyses: total.count,
    todayAnalyses: today.count,
    uniqueUsers: unique.count,
    uniqueToday: uniqueToday.count,
    errorRate: Math.round(errorRate * 10) / 10,
    artGenerations: artTotal.count,
    cacheHitRate: Math.round(cacheRate * 10) / 10,
    gateUnlocks: gateUnlocks.count,
    avgPlaytimeHours: avgPlaytime.avg ? Math.round(avgPlaytime.avg) : 0,
  };
}

// === Traffic ===

export function getAnalysesByDay(days: number = 30) {
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  return query<{ day: string; count: number; cached: number; fresh: number }>(
    `SELECT
      date(timestamp / 1000, 'unixepoch') as day,
      COUNT(*) as count,
      SUM(CASE WHEN cached = 1 THEN 1 ELSE 0 END) as cached,
      SUM(CASE WHEN cached = 0 THEN 1 ELSE 0 END) as fresh
    FROM analyses WHERE timestamp > ?
    GROUP BY day ORDER BY day`,
    [since],
  );
}

export function getLocaleDistribution() {
  return query<{ locale: string; count: number }>(
    "SELECT locale, COUNT(*) as count FROM analyses GROUP BY locale ORDER BY count DESC",
  );
}

export function getCacheDistribution() {
  return query<{ cached: number; count: number }>(
    "SELECT cached, COUNT(*) as count FROM analyses GROUP BY cached",
  );
}

// === Users ===

export function getRarityDistribution() {
  return query<{ rarity: string; count: number }>(
    "SELECT rarity, COUNT(*) as count FROM analyses WHERE rarity IS NOT NULL AND cached = 0 GROUP BY rarity ORDER BY count DESC",
  );
}

export function getAverageStats() {
  return queryOne<{
    dedication: number; mastery: number; exploration: number;
    hoarding: number; social: number; veteran: number;
  }>(
    `SELECT
      ROUND(AVG(stat_dedication)) as dedication,
      ROUND(AVG(stat_mastery)) as mastery,
      ROUND(AVG(stat_exploration)) as exploration,
      ROUND(AVG(stat_hoarding)) as hoarding,
      ROUND(AVG(stat_social)) as social,
      ROUND(AVG(stat_veteran)) as veteran
    FROM analyses WHERE cached = 0 AND stat_dedication IS NOT NULL`,
  );
}

export function getTopArchetypes(limit: number = 10) {
  return query<{ primary_archetype: string; count: number }>(
    "SELECT primary_archetype, COUNT(*) as count FROM analyses WHERE primary_archetype IS NOT NULL AND cached = 0 GROUP BY primary_archetype ORDER BY count DESC LIMIT ?",
    [limit],
  );
}

export function getTopCreatures(limit: number = 10) {
  return query<{ spirit_animal: string; count: number }>(
    "SELECT spirit_animal, COUNT(*) as count FROM analyses WHERE spirit_animal IS NOT NULL AND cached = 0 GROUP BY spirit_animal ORDER BY count DESC LIMIT ?",
    [limit],
  );
}

export function getTopElements(limit: number = 10) {
  return query<{ element: string; count: number }>(
    "SELECT element, COUNT(*) as count FROM analyses WHERE element IS NOT NULL AND cached = 0 GROUP BY element ORDER BY count DESC LIMIT ?",
    [limit],
  );
}

// === Costs ===

const LLM_COST_PER_ANALYSIS = 0.003;
const ART_COST_PER_GEN = 0.04;

export function getCostsByDay(days: number = 30) {
  const since = Date.now() - days * 24 * 60 * 60 * 1000;

  const analyses = query<{ day: string; count: number }>(
    `SELECT date(timestamp / 1000, 'unixepoch') as day, COUNT(*) as count
     FROM analyses WHERE cached = 0 AND timestamp > ?
     GROUP BY day ORDER BY day`,
    [since],
  );

  const artGens = query<{ day: string; count: number }>(
    `SELECT date(timestamp / 1000, 'unixepoch') as day, COUNT(*) as count
     FROM art_generations WHERE cached = 0 AND timestamp > ?
     GROUP BY day ORDER BY day`,
    [since],
  );

  const artByDay = new Map(artGens.map((r) => [r.day, r.count]));

  return analyses.map((r) => ({
    day: r.day,
    llmCount: r.count,
    artCount: artByDay.get(r.day) || 0,
    llmCost: Math.round(r.count * LLM_COST_PER_ANALYSIS * 1000) / 1000,
    artCost: Math.round((artByDay.get(r.day) || 0) * ART_COST_PER_GEN * 1000) / 1000,
    totalCost: Math.round((r.count * LLM_COST_PER_ANALYSIS + (artByDay.get(r.day) || 0) * ART_COST_PER_GEN) * 1000) / 1000,
  }));
}

export function getTotalCosts() {
  const llm = queryOne<{ count: number }>("SELECT COUNT(*) as count FROM analyses WHERE cached = 0") ?? { count: 0 };
  const art = queryOne<{ count: number }>("SELECT COUNT(*) as count FROM art_generations WHERE cached = 0") ?? { count: 0 };
  return {
    llmTotal: Math.round(llm.count * LLM_COST_PER_ANALYSIS * 100) / 100,
    artTotal: Math.round(art.count * ART_COST_PER_GEN * 100) / 100,
    grandTotal: Math.round((llm.count * LLM_COST_PER_ANALYSIS + art.count * ART_COST_PER_GEN) * 100) / 100,
    llmCount: llm.count,
    artCount: art.count,
  };
}

// === Telegram ===

export function getGateEventsByDay(days: number = 30) {
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  return query<{ day: string; event: string; count: number }>(
    `SELECT date(timestamp / 1000, 'unixepoch') as day, event, COUNT(*) as count
     FROM gate_events WHERE timestamp > ?
     GROUP BY day, event ORDER BY day`,
    [since],
  );
}

export function getGateFunnel() {
  return query<{ event: string; count: number }>(
    "SELECT event, COUNT(*) as count FROM gate_events GROUP BY event ORDER BY count DESC",
  );
}

// === System ===

export function getRecentErrors(limit: number = 50) {
  return query<{ id: number; type: string; message: string | null; timestamp: number; endpoint: string | null }>(
    "SELECT id, type, message, timestamp, endpoint FROM errors ORDER BY timestamp DESC LIMIT ?",
    [limit],
  );
}

export function getDbSize(): number {
  const db = getDb();
  if (!db) return 0;
  try {
    const row = db.prepare("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()").get() as { size: number } | undefined;
    return row?.size || 0;
  } catch {
    return 0;
  }
}

export function getTableCounts() {
  return {
    analyses: (queryOne<{ count: number }>("SELECT COUNT(*) as count FROM analyses") ?? { count: 0 }).count,
    errors: (queryOne<{ count: number }>("SELECT COUNT(*) as count FROM errors") ?? { count: 0 }).count,
    art_generations: (queryOne<{ count: number }>("SELECT COUNT(*) as count FROM art_generations") ?? { count: 0 }).count,
    gate_events: (queryOne<{ count: number }>("SELECT COUNT(*) as count FROM gate_events") ?? { count: 0 }).count,
  };
}
