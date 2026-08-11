import type Database from "better-sqlite3";
import { getIdentityDb } from "./db";

export type Provider = "telegram" | "steam";

export type LoginResult =
  | { status: "ok"; accountId: number }
  /** Привязка уже указывает на ДРУГОЙ аккаунт. Молча переклеивать нельзя. */
  | { status: "taken" }
  /** База недоступна или запись не удалась. Вход не состоялся — молча пускать нельзя. */
  | { status: "unavailable" };

interface IdentityRow {
  provider: Provider;
  provider_id: string;
  account_id: number;
  verified: number;
}

function findIn(db: Database.Database, provider: Provider, providerId: string): number | null {
  const row = db
    .prepare("SELECT account_id FROM identities WHERE provider = ? AND provider_id = ?")
    .get(provider, providerId) as { account_id: number } | undefined;
  return row ? row.account_id : null;
}

export function findAccountByIdentity(provider: Provider, providerId: string): number | null {
  const db = getIdentityDb();
  if (!db) return null;
  try {
    return findIn(db, provider, providerId);
  } catch (err) {
    console.error("[identity] чтение привязки не удалось:", err);
    return null;
  }
}

export function listIdentities(
  accountId: number,
): Array<{ provider: Provider; providerId: string; verified: boolean }> {
  const db = getIdentityDb();
  if (!db) return [];
  try {
    const rows = db
      .prepare("SELECT provider, provider_id, verified FROM identities WHERE account_id = ? ORDER BY created_at, rowid")
      .all(accountId) as IdentityRow[];
    return rows.map((r) => ({
      provider: r.provider,
      providerId: r.provider_id,
      verified: r.verified === 1,
    }));
  } catch (err) {
    console.error("[identity] чтение привязок аккаунта не удалось:", err);
    return [];
  }
}

/**
 * Единственная точка входа в аккаунт.
 *
 * Автоматической склейки аккаунтов здесь нет намеренно: когда привязка уже
 * принадлежит другому аккаунту, мы отвечаем "taken" и говорим об этом
 * человеку. Молчаливое объединение — это и потерянные покупки, и способ
 * увести чужой аккаунт, подсунув свою привязку.
 */
export function loginOrCreate(
  provider: Provider,
  providerId: string,
  opts: { currentAccountId?: number | null; verified?: boolean } = {},
): LoginResult {
  const db = getIdentityDb();
  if (!db) return { status: "unavailable" };

  const now = Math.floor(Date.now() / 1000);
  const verified = opts.verified ? 1 : 0;

  // Проверка и вставка — одной транзакцией. Между SELECT и INSERT второй
  // писатель успевает создать ту же привязку: мы получаем нарушение UNIQUE
  // и уже созданную осиротевшую строку accounts. Путей к параллелизму
  // сегодня нет, но оплата (план Б) приводит второго писателя.
  const attempt = db.transaction((): LoginResult => {
    const existing = findIn(db, provider, providerId);

    if (existing !== null) {
      if (opts.currentAccountId && opts.currentAccountId !== existing) {
        return { status: "taken" };
      }
      // Вход через Steam доказывает владение; отметку подтверждения не снимаем.
      if (verified === 1) {
        db.prepare("UPDATE identities SET verified = 1 WHERE provider = ? AND provider_id = ?")
          .run(provider, providerId);
      }
      return { status: "ok", accountId: existing };
    }

    // Аккаунт из куки мог не пережить базу (переезд, чистка). Тогда кука —
    // просто мусор: заводим новый аккаунт вместо отказа навсегда. Проверка
    // обязательна ещё и потому, что с foreign_keys = ON вставка в identities
    // на несуществующий аккаунт теперь падает.
    const claimed = opts.currentAccountId ?? null;
    const accountExists =
      claimed !== null &&
      db.prepare("SELECT 1 FROM accounts WHERE id = ?").get(claimed) !== undefined;

    const accountId = accountExists
      ? (claimed as number)
      : Number(db.prepare("INSERT INTO accounts (created_at) VALUES (?)").run(now).lastInsertRowid);

    db.prepare(
      "INSERT INTO identities (provider, provider_id, account_id, verified, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(provider, providerId, accountId, verified, now);

    return { status: "ok", accountId };
  });

  try {
    return attempt();
  } catch (err) {
    // Гонка, нарушение целостности, сломанная база — вход не состоялся.
    // Транзакция откатилась целиком, осиротевших аккаунтов не остаётся.
    console.error("[identity] вход не удался:", err);
    return { status: "unavailable" };
  }
}

/**
 * Владение — это ПОДТВЕРЖДЁННАЯ привязка Steam, и только она. Вход через
 * Telegram владельцем не делает: сказать «это мой аккаунт» может кто угодно.
 * Любая беда с базой тоже означает «не владелец»: ошибка понижает права.
 */
export function accountOwnsSteamId(accountId: number, steamId64: string): boolean {
  const db = getIdentityDb();
  if (!db) return false;
  try {
    const row = db
      .prepare(
        "SELECT 1 FROM identities WHERE account_id = ? AND provider = 'steam' AND provider_id = ? AND verified = 1",
      )
      .get(accountId, steamId64);
    return row !== undefined;
  } catch (err) {
    console.error("[identity] проверка владения не удалась:", err);
    return false;
  }
}
