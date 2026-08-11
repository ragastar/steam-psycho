import { getIdentityDb } from "../identity/db";

let migrated = false;

/**
 * Таблицы денег живут в том же файле базы, что и аккаунты: у entitlements
 * внешний ключ на accounts, а межбазовых ключей в SQLite не бывает.
 *
 * Требование плана — «ошибка любого рода закрывает доступ, а не открывает» —
 * распространяется и на саму миграцию: getIdentityDb() у себя оборачивает
 * open+pragma+migrate в try/catch и возвращает null при сбое, и здесь тот же
 * контракт. Без этого один упавший db.exec бросал бы исключение наружу
 * каждого потребителя в store.ts, у которого getBillingDb() вызывается вне
 * try-блока.
 */
export function getBillingDb() {
  const db = getIdentityDb();
  if (!db || migrated) return db;
  try {
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
    // Присваиваем только после успешной миграции — как в getIdentityDb():
    // иначе полумигрированная база закешируется через `migrated` и все
    // дальнейшие вызовы будут молча пропускать миграцию, думая, что она
    // уже случилась.
    migrated = true;
    return db;
  } catch (err) {
    console.error("[billing] миграция таблиц заказов не удалась:", err);
    return null;
  }
}
