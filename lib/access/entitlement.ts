import crypto from "crypto";
import { cookies } from "next/headers";

/**
 * Единственное место, где решается, что человеку можно показывать.
 *
 * Раньше это решал браузер: сервер отдавал всё, а компонент размывал лишнее.
 * Теперь наоборот — сервер выдаёт подписанную куку, и только она открывает
 * полный результат. Сегодня куку выдаёт подписка на Telegram-канал, завтра
 * её будет выдавать оплата: менять придётся только грант, а не проверки.
 */

export type AccessLevel = "free" | "full";

const COOKIE_PREFIX = "gt_access_";
const MAX_AGE = 30 * 24 * 3600; // 30 дней

function getSecret(): string {
  const secret = process.env.ACCESS_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("ACCESS_SECRET не задан или слишком короткий (нужно ≥16 символов)");
  }
  return secret;
}

function cookieName(steamId64: string): string {
  return `${COOKIE_PREFIX}${steamId64}`;
}

/** Подпись привязана к конкретному профилю и сроку — куку нельзя переклеить. */
function sign(steamId64: string, expiresAt: number): string {
  return crypto
    .createHmac("sha256", getSecret())
    .update(`${steamId64}:${expiresAt}`)
    .digest("hex");
}

export function issueAccessCookie(steamId64: string): {
  name: string;
  value: string;
  options: Record<string, unknown>;
} {
  const expiresAt = Math.floor(Date.now() / 1000) + MAX_AGE;
  return {
    name: cookieName(steamId64),
    value: `${expiresAt}.${sign(steamId64, expiresAt)}`,
    options: {
      httpOnly: true,
      // По HTTP браузер молча отбрасывает куку с Secure, поэтому для зеркала
      // на голом IP нужен явный тумблер. Включать только там, где нет TLS.
      secure: process.env.NODE_ENV === "production" && process.env.ALLOW_INSECURE_COOKIES !== "true",
      sameSite: "lax",
      path: "/",
      maxAge: MAX_AGE,
    },
  };
}

export function verifyAccessValue(steamId64: string, value: string | undefined): boolean {
  if (!value) return false;
  const [rawExp, providedSig] = value.split(".");
  if (!rawExp || !providedSig) return false;

  const expiresAt = Number(rawExp);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now() / 1000) return false;

  const expected = sign(steamId64, expiresAt);
  // Длины совпадают всегда (hex sha256), но timingSafeEqual падает при разных —
  // поэтому проверяем перед сравнением.
  if (expected.length !== providedSig.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(providedSig));
}

export async function getAccessLevel(steamId64: string): Promise<AccessLevel> {
  // Серверный тумблер для отладки. Раньше это был NEXT_PUBLIC_DISABLE_GATE —
  // то есть флаг, который видел и мог подставить сам браузер.
  if (process.env.DISABLE_GATE === "true") return "full";

  try {
    const store = await cookies();
    const raw = store.get(cookieName(steamId64))?.value;
    return verifyAccessValue(steamId64, raw) ? "full" : "free";
  } catch {
    // Нет доступа к кукам или не задан секрет — закрываем, а не открываем.
    return "free";
  }
}
