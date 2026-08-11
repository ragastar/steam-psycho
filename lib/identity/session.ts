import crypto from "crypto";
import { cookies } from "next/headers";

/**
 * Кука сессии отвечает на вопрос «кто вошёл», и только на него.
 *
 * Право смотреть платное живёт на сервере (план Б) — кука его не несёт.
 * Это и есть разница с `lib/access/entitlement.ts`, где подпись в куке была
 * источником правды и делала восстановление покупки невозможным.
 */
export const SESSION_COOKIE = "gt_session";

const MAX_AGE = 180 * 24 * 3600;

function getSecret(): string {
  const secret = process.env.ACCESS_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("ACCESS_SECRET не задан или слишком короткий (нужно ≥16 символов)");
  }
  return secret;
}

function sign(accountId: number, expiresAt: number): string {
  return crypto.createHmac("sha256", getSecret()).update(`${accountId}:${expiresAt}`).digest("hex");
}

export function issueSessionCookie(accountId: number) {
  const expiresAt = Math.floor(Date.now() / 1000) + MAX_AGE;
  return {
    name: SESSION_COOKIE,
    value: `${accountId}.${expiresAt}.${sign(accountId, expiresAt)}`,
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production" && process.env.ALLOW_INSECURE_COOKIES !== "true",
      sameSite: "lax" as const,
      path: "/",
      maxAge: MAX_AGE,
    },
  };
}

export function verifySessionValue(value: string | undefined): number | null {
  if (!value) return null;
  const [rawId, rawExp, providedSig] = value.split(".");
  if (!rawId || !rawExp || !providedSig) return null;

  const accountId = Number(rawId);
  const expiresAt = Number(rawExp);
  if (!Number.isInteger(accountId) || accountId <= 0) return null;
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now() / 1000) return null;

  const expected = sign(accountId, expiresAt);
  // timingSafeEqual падает на разной длине, поэтому длину проверяем заранее.
  if (expected.length !== providedSig.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(providedSig))) return null;

  return accountId;
}

export async function getCurrentAccountId(): Promise<number | null> {
  try {
    const store = await cookies();
    return verifySessionValue(store.get(SESSION_COOKIE)?.value);
  } catch {
    // Нет доступа к кукам или не задан секрет — считаем, что не вошёл.
    return null;
  }
}
