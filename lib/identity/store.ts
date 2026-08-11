import { getIdentityDb } from "./db";

export type Provider = "telegram" | "steam";

export type LoginResult =
  | { status: "ok"; accountId: number }
  /** Привязка уже указывает на ДРУГОЙ аккаунт. Молча переклеивать нельзя. */
  | { status: "taken" };

interface IdentityRow {
  provider: Provider;
  provider_id: string;
  account_id: number;
  verified: number;
}

export function findAccountByIdentity(provider: Provider, providerId: string): number | null {
  const row = getIdentityDb()
    .prepare("SELECT account_id FROM identities WHERE provider = ? AND provider_id = ?")
    .get(provider, providerId) as { account_id: number } | undefined;
  return row ? row.account_id : null;
}

export function listIdentities(
  accountId: number,
): Array<{ provider: Provider; providerId: string; verified: boolean }> {
  const rows = getIdentityDb()
    .prepare("SELECT provider, provider_id, verified FROM identities WHERE account_id = ? ORDER BY created_at, rowid")
    .all(accountId) as IdentityRow[];
  return rows.map((r) => ({
    provider: r.provider,
    providerId: r.provider_id,
    verified: r.verified === 1,
  }));
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
  const now = Math.floor(Date.now() / 1000);
  const verified = opts.verified ? 1 : 0;
  const existing = findAccountByIdentity(provider, providerId);

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

  const accountId =
    opts.currentAccountId ??
    Number(db.prepare("INSERT INTO accounts (created_at) VALUES (?)").run(now).lastInsertRowid);

  db.prepare(
    "INSERT INTO identities (provider, provider_id, account_id, verified, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(provider, providerId, accountId, verified, now);

  return { status: "ok", accountId };
}

/**
 * Владение — это ПОДТВЕРЖДЁННАЯ привязка Steam, и только она. Вход через
 * Telegram владельцем не делает: сказать «это мой аккаунт» может кто угодно.
 */
export function accountOwnsSteamId(accountId: number, steamId64: string): boolean {
  const row = getIdentityDb()
    .prepare(
      "SELECT 1 FROM identities WHERE account_id = ? AND provider = 'steam' AND provider_id = ? AND verified = 1",
    )
    .get(accountId, steamId64);
  return row !== undefined;
}
