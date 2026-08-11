import { getIdentityDb } from "../identity/db";

let migrated = false;

/**
 * Таблицы денег живут в том же файле базы, что и аккаунты: у entitlements
 * внешний ключ на accounts, а межбазовых ключей в SQLite не бывает.
 */
export function getBillingDb() {
  const db = getIdentityDb();
  if (!db || migrated) return db;
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      steam_id64 TEXT NOT NULL,
      amount_kop INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'RUB',
      provider TEXT NOT NULL,
      provider_order_id TEXT,
      idempotency_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'created',
      created_at INTEGER NOT NULL,
      paid_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS entitlements (
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      steam_id64 TEXT NOT NULL,
      source TEXT NOT NULL,
      order_id INTEGER REFERENCES orders(id),
      expires_at INTEGER,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (account_id, steam_id64)
    );
  `);
  migrated = true;
  return db;
}
