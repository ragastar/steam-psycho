import Database from "better-sqlite3";
import path from "path";

const DB_PATH = process.env.ANALYTICS_DB_PATH || path.join("/data", "db", "analytics.db");

let db: Database.Database | null = null;

function getDb(): Database.Database | null {
  if (db) return db;
  try {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 5000");
    migrate(db);
    return db;
  } catch (err) {
    console.error("[analytics] Failed to open SQLite:", err);
    return null;
  }
}

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS analyses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      steam_id64 TEXT NOT NULL,
      locale TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      rarity TEXT,
      stat_dedication INTEGER,
      stat_mastery INTEGER,
      stat_exploration INTEGER,
      stat_hoarding INTEGER,
      stat_social INTEGER,
      stat_veteran INTEGER,
      primary_archetype TEXT,
      spirit_animal TEXT,
      element TEXT,
      library_size INTEGER,
      total_playtime_hours REAL,
      account_age_years REAL,
      llm_provider TEXT,
      cached INTEGER NOT NULL DEFAULT 0,
      ip_hash TEXT
    );

    CREATE TABLE IF NOT EXISTS errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      message TEXT,
      timestamp INTEGER NOT NULL,
      ip_hash TEXT,
      endpoint TEXT
    );

    CREATE TABLE IF NOT EXISTS art_generations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      steam_id64 TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      cached INTEGER NOT NULL DEFAULT 0
    );

    -- Гейт на подписку канала отменён (2026-08-10), новых строк тут не
    -- появляется. Таблица заводится по-прежнему: в боевой базе лежат события за
    -- прошлые месяцы, админка их читает, а на чистой базе без CREATE её запросы
    -- падали бы.
    CREATE TABLE IF NOT EXISTS gate_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      steam_id64 TEXT,
      event TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );

    -- Обратная связь с сайта. Живёт в той же базе, что аналитика: читает её
    -- админка, а заводить второй файл ради одной таблицы незачем.
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      text TEXT NOT NULL,
      contact TEXT,
      steam_id64 TEXT,
      page TEXT,
      ip_hash TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_feedback_timestamp ON feedback(timestamp);
    CREATE INDEX IF NOT EXISTS idx_analyses_timestamp ON analyses(timestamp);
    CREATE INDEX IF NOT EXISTS idx_analyses_steam_id64 ON analyses(steam_id64);
    CREATE INDEX IF NOT EXISTS idx_errors_timestamp ON errors(timestamp);
    CREATE INDEX IF NOT EXISTS idx_art_generations_timestamp ON art_generations(timestamp);
    CREATE INDEX IF NOT EXISTS idx_gate_events_timestamp ON gate_events(timestamp);
  `);
}

// Fire-and-forget inserts — never break the main flow

export function logAnalysis(data: {
  steamId64: string;
  locale: string;
  rarity?: string;
  stats?: { dedication: number; mastery: number; exploration: number; hoarding: number; social: number; veteran: number };
  primaryArchetype?: string;
  spiritAnimal?: string;
  element?: string;
  librarySize?: number;
  totalPlaytimeHours?: number;
  accountAgeYears?: number;
  llmProvider?: string;
  cached: boolean;
  ipHash?: string;
}) {
  try {
    const d = getDb();
    if (!d) return;
    d.prepare(`
      INSERT INTO analyses (steam_id64, locale, timestamp, rarity,
        stat_dedication, stat_mastery, stat_exploration, stat_hoarding, stat_social, stat_veteran,
        primary_archetype, spirit_animal, element, library_size, total_playtime_hours, account_age_years,
        llm_provider, cached, ip_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.steamId64, data.locale, Date.now(), data.rarity || null,
      data.stats?.dedication ?? null, data.stats?.mastery ?? null, data.stats?.exploration ?? null,
      data.stats?.hoarding ?? null, data.stats?.social ?? null, data.stats?.veteran ?? null,
      data.primaryArchetype || null, data.spiritAnimal || null, data.element || null,
      data.librarySize ?? null, data.totalPlaytimeHours ?? null, data.accountAgeYears ?? null,
      data.llmProvider || null, data.cached ? 1 : 0, data.ipHash || null,
    );
  } catch (err) {
    console.error("[analytics] logAnalysis failed:", err);
  }
}

/** Ограничения на одно сообщение: длиннее в базу не кладём и обрезаем молча. */
export const FEEDBACK_MAX_TEXT = 4000;
export const FEEDBACK_MAX_CONTACT = 200;

export function logFeedback(data: {
  text: string;
  contact?: string;
  steamId64?: string;
  page?: string;
  ipHash?: string;
}): boolean {
  try {
    const d = getDb();
    if (!d) return false;
    d.prepare(`
      INSERT INTO feedback (timestamp, text, contact, steam_id64, page, ip_hash)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      Date.now(),
      data.text.slice(0, FEEDBACK_MAX_TEXT),
      data.contact?.slice(0, FEEDBACK_MAX_CONTACT) || null,
      data.steamId64 || null,
      data.page || null,
      data.ipHash || null,
    );
    return true;
  } catch (err) {
    console.error("[analytics] logFeedback failed:", err);
    return false;
  }
}

export function logError(data: {
  type: string;
  message?: string;
  ipHash?: string;
  endpoint?: string;
}) {
  try {
    const d = getDb();
    if (!d) return;
    d.prepare(`INSERT INTO errors (type, message, timestamp, ip_hash, endpoint) VALUES (?, ?, ?, ?, ?)`)
      .run(data.type, data.message || null, Date.now(), data.ipHash || null, data.endpoint || null);
  } catch (err) {
    console.error("[analytics] logError failed:", err);
  }
}

export function logArtGeneration(data: {
  steamId64: string;
  cached: boolean;
}) {
  try {
    const d = getDb();
    if (!d) return;
    d.prepare(`INSERT INTO art_generations (steam_id64, timestamp, cached) VALUES (?, ?, ?)`)
      .run(data.steamId64, Date.now(), data.cached ? 1 : 0);
  } catch (err) {
    console.error("[analytics] logArtGeneration failed:", err);
  }
}

// Записи в gate_events здесь больше нет: гейт на подписку канала отменён, и
// писать в эту таблицу стало некому. Сама таблица и запросы к ней остаются —
// в боевой базе лежат события за прошлые месяцы, и админка их показывает.

export { getDb };
