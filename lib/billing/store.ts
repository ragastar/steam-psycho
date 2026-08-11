import { getBillingDb } from "./db";

export type OrderStatus = "created" | "paid" | "cancelled";

export interface Order {
  id: number;
  accountId: number;
  steamId64: string;
  amountKop: number;
  currency: string;
  provider: string;
  providerOrderId: string | null;
  idempotencyKey: string;
  status: OrderStatus;
  createdAt: number;
  paidAt: number | null;
}

interface OrderRow {
  id: number;
  account_id: number;
  steam_id64: string;
  amount_kop: number;
  currency: string;
  provider: string;
  provider_order_id: string | null;
  idempotency_key: string;
  status: OrderStatus;
  created_at: number;
  paid_at: number | null;
}

function mapOrder(row: OrderRow): Order {
  return {
    id: row.id,
    accountId: row.account_id,
    steamId64: row.steam_id64,
    amountKop: row.amount_kop,
    currency: row.currency,
    provider: row.provider,
    providerOrderId: row.provider_order_id,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    createdAt: row.created_at,
    paidAt: row.paid_at,
  };
}

/**
 * Отвечает ли база вообще. Нужна тем, кто получил null от findOrder и обязан
 * различить «такого заказа нет» и «база не открылась»: первое — окончательный
 * ответ, второе — беда на нашей стороне, на которую нельзя отвечать 404.
 * База бывает недоступна СТОЙКО (неоткрываемый файл, упавшая миграция), и
 * тогда «нет такого заказа» звучало бы приговором каждой оплате подряд.
 */
export function billingAvailable(): boolean {
  return getBillingDb() !== null;
}

/**
 * Создаёт заказ или, если такой idempotencyKey уже встречался, возвращает
 * существующий. Защищает и от двойного нажатия кнопки «купить» (два запроса
 * с одним ключом), и от повторного создания при ретрае сети.
 *
 * `provider` обязателен и пишется как есть — заглушка помечает свои заказы
 * `'stub'`, боевая касса — `'yookassa'`; так поддельные заказы никогда не
 * смешаются с настоящими в отчётах.
 */
export function createOrder(a: {
  accountId: number;
  steamId64: string;
  amountKop: number;
  provider: string;
  idempotencyKey: string;
}): { id: number } | null {
  const db = getBillingDb();
  if (!db) return null;

  const now = Math.floor(Date.now() / 1000);

  // Проверка и вставка — одной транзакцией: тот же приём, что в
  // identity/store.ts loginOrCreate, по той же причине — между SELECT и
  // INSERT второй писатель успевает вставить заказ с тем же ключом.
  const attempt = db.transaction((): { id: number } => {
    const existing = db
      .prepare("SELECT id FROM orders WHERE idempotency_key = ?")
      .get(a.idempotencyKey) as { id: number } | undefined;
    if (existing) return { id: existing.id };

    const result = db
      .prepare(
        `INSERT INTO orders
           (account_id, steam_id64, amount_kop, currency, provider, idempotency_key, status, created_at)
         VALUES (?, ?, ?, 'RUB', ?, ?, 'created', ?)`,
      )
      .run(a.accountId, a.steamId64, a.amountKop, a.provider, a.idempotencyKey, now);

    return { id: Number(result.lastInsertRowid) };
  });

  try {
    return attempt();
  } catch (err) {
    console.error("[billing] создание заказа не удалось:", err);
    return null;
  }
}

export function findOrder(id: number): Order | null {
  const db = getBillingDb();
  if (!db) return null;
  try {
    const row = db.prepare("SELECT * FROM orders WHERE id = ?").get(id) as OrderRow | undefined;
    return row ? mapOrder(row) : null;
  } catch (err) {
    console.error("[billing] чтение заказа не удалось:", err);
    return null;
  }
}

/** Последний незакрытый (status = 'created') заказ аккаунта на этот steamId. */
export function findOpenOrder(accountId: number, steamId64: string): Order | null {
  const db = getBillingDb();
  if (!db) return null;
  try {
    const row = db
      .prepare(
        `SELECT * FROM orders
         WHERE account_id = ? AND steam_id64 = ? AND status = 'created'
         ORDER BY created_at DESC, id DESC LIMIT 1`,
      )
      .get(accountId, steamId64) as OrderRow | undefined;
    return row ? mapOrder(row) : null;
  } catch (err) {
    console.error("[billing] поиск открытого заказа не удался:", err);
    return null;
  }
}

/**
 * Подтверждение оплаты от кассы. Вебхуки от касс приходят по два штатно —
 * второй вызов для уже подтверждённого заказа должен отвечать "already" и
 * ничего не менять, а не выдавать второе право.
 *
 * Единственные ворота идемпотентности — сам условный UPDATE
 * (`WHERE id = ? AND status = 'created'`) и его `changes`, а не более
 * раннее чтение статуса: если изменилась ровно одна строка — заказ только
 * что перешёл в paid именно этим вызовом, и только этот вызов вставляет
 * право. Если ноль — заказ либо не найден, либо уже не в 'created' (payload
 * условие в UPDATE не даёт двум вызовам одновременно решить, что "created"
 * ещё они). Внутри одного процесса better-sqlite3 синхронен и второй вызов
 * markPaid физически не может начаться, пока не завершится первый — но
 * ворота одни и в сценарии нескольких процессов на одном файле базы
 * (несколько воркеров), где чтение вне записи ничего не гарантирует.
 *
 * "granted" означает «этот вызов подтвердил заказ», а не «именно сейчас
 * появилась строка в entitlements»: если право на этот (accountId, steamId)
 * уже стоит от другого заказа (см. INSERT OR IGNORE ниже), ответ всё равно
 * "granted" — заказ реально оплачен и переведён в paid.
 */
export function markPaid(
  orderId: number,
  providerOrderId: string,
): "granted" | "already" | "unknown" | "unavailable" {
  const db = getBillingDb();
  // "unavailable", а не "unknown": вызывающий обязан отличить «нет такого
  // заказа» от «база не ответила». Первое кассе отвечают 404 и она перестаёт
  // повторять, второе — 5xx, и оплата не теряется.
  if (!db) return "unavailable";

  const attempt = db.transaction((): "granted" | "already" | "unknown" => {
    const row = db
      .prepare("SELECT account_id, steam_id64 FROM orders WHERE id = ?")
      .get(orderId) as { account_id: number; steam_id64: string } | undefined;

    if (!row) return "unknown";

    const now = Math.floor(Date.now() / 1000);

    const updated = db
      .prepare("UPDATE orders SET status = 'paid', provider_order_id = ?, paid_at = ? WHERE id = ? AND status = 'created'")
      .run(providerOrderId, now, orderId);

    if (updated.changes === 0) return "already";

    // OR IGNORE: право на этот steamId у аккаунта уже может быть (куплено
    // раньше другим заказом) — тогда insert молча отбрасывается, вторую
    // строку права заводить незачем, а функция всё равно отвечает "granted"
    // (см. комментарий над функцией).
    db.prepare(
      `INSERT OR IGNORE INTO entitlements (account_id, steam_id64, source, order_id, expires_at, created_at)
       VALUES (?, ?, 'purchase', ?, NULL, ?)`,
    ).run(row.account_id, row.steam_id64, orderId, now);

    return "granted";
  });

  try {
    return attempt();
  } catch (err) {
    console.error("[billing] подтверждение оплаты не удалось:", err);
    return "unavailable";
  }
}

/**
 * Отклонение платежа: заказ закрывается отказом и права не получает.
 *
 * Повадки те же, что у markPaid, и по тем же причинам: единственные ворота —
 * условная запись `WHERE id = ? AND status = 'created'` и её `changes`, а не
 * прочитанный заранее статус. Чтение ниже нужно только чтобы ОБЪЯСНИТЬ, почему
 * записи не случилось, и на решение уже не влияет.
 *
 * Оплаченный заказ отменить нельзя: деньги взяты, право выдано, и отзыв
 * доступа — это работа руками через админку, а не тихая правка статуса по
 * запоздавшему вебхуку. Такой случай возвращает "paid", чтобы вызывающий мог
 * сказать о расхождении вслух.
 */
export function markCancelled(orderId: number): "cancelled" | "already" | "paid" | "unknown" | "unavailable" {
  const db = getBillingDb();
  if (!db) return "unavailable";

  const attempt = db.transaction((): "cancelled" | "already" | "paid" | "unknown" => {
    const updated = db
      .prepare("UPDATE orders SET status = 'cancelled' WHERE id = ? AND status = 'created'")
      .run(orderId);

    if (updated.changes === 1) return "cancelled";

    const row = db.prepare("SELECT status FROM orders WHERE id = ?").get(orderId) as
      | { status: OrderStatus }
      | undefined;

    if (!row) return "unknown";
    return row.status === "paid" ? "paid" : "already";
  });

  try {
    return attempt();
  } catch (err) {
    console.error("[billing] отмена заказа не удалась:", err);
    return "unavailable";
  }
}

/**
 * Право бессрочное по умолчанию (expires_at пусто), но поле уже учитываем:
 * просроченное право доступа не даёт. Любая беда с базой — тоже "нет права":
 * ошибка понижает доступ, а не повышает.
 */
export function hasEntitlement(accountId: number, steamId64: string): boolean {
  const db = getBillingDb();
  if (!db) return false;
  try {
    const now = Math.floor(Date.now() / 1000);
    const row = db
      .prepare(
        `SELECT 1 FROM entitlements
         WHERE account_id = ? AND steam_id64 = ? AND (expires_at IS NULL OR expires_at > ?)`,
      )
      .get(accountId, steamId64, now);
    return row !== undefined;
  } catch (err) {
    console.error("[billing] проверка права не удалась:", err);
    return false;
  }
}
