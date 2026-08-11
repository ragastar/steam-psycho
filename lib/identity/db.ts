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

/**
 * Возвращает null, если базу открыть не удалось, — как `lib/analytics/db.ts`.
 *
 * Личность нужна странице результата ради одного бейджа «твой профиль».
 * Пусть беда с базой стоит бейджа, а не всей страницы: раньше исключение
 * отсюда превращалось в 500 на главной странице продукта, которая до этого
 * от состояния базы не зависела вовсе. Отсутствие базы читается как
 * «ничего не знаем про этого человека» — то есть прав не прибавляет.
 */
export function getIdentityDb(): Database.Database | null {
  if (db) return db;
  try {
    const opened = new Database(DB_PATH);
    opened.pragma("journal_mode = WAL");
    opened.pragma("busy_timeout = 5000");
    // Ссылочная целостность: account_id в identities приходит в конечном
    // счёте из куки, и без этого SQLite молча примет привязку к аккаунту,
    // которого нет.
    opened.pragma("foreign_keys = ON");
    migrate(opened);
    // Присваиваем только после успешной миграции: иначе полуоткрытая база
    // закешируется и все дальнейшие запросы будут падать на ней.
    db = opened;
    return db;
  } catch (err) {
    console.error("[identity] не удалось открыть SQLite:", err);
    return null;
  }
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
