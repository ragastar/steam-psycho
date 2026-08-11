import Database from "better-sqlite3";
import path from "path";

/**
 * Своё соединение, а не общее с аналитикой: `lib/analytics/db.ts` держит
 * открытие базы внутри себя и запускает там же свою миграцию. Вытаскивать
 * его наружу — правка десятка функций живой аналитики ради красоты.
 * Два соединения к одному файлу при WAL — штатный режим SQLite.
 */
const DB_PATH =
  process.env.IDENTITY_DB_PATH ||
  process.env.ANALYTICS_DB_PATH ||
  path.join("/data", "db", "analytics.db");

let db: Database.Database | null = null;

export function getIdentityDb(): Database.Database {
  if (db) return db;
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  return db;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS identities (
      provider TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      verified INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (provider, provider_id)
    );

    CREATE INDEX IF NOT EXISTS identities_account ON identities(account_id);
  `);
}
