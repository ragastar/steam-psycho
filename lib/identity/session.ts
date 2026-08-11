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

/**
 * Одноразовая кука, привязывающая токен входа через Telegram к тому браузеру,
 * который вход начал. Живёт здесь, а не в маршруте: имя нужно и на выдаче
 * (/start), и на обмене (/claim), а из файла маршрута экспортировать можно
 * только обработчик и runtime.
 */
export const LOGIN_TOKEN_COOKIE = "gt_login";

const MAX_AGE = 180 * 24 * 3600;

/** Правила безопасности у всех наших кук одни. */
export interface CookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
}

export interface SessionCookie {
  name: string;
  value: string;
  options: CookieOptions;
}

function secureCookies(): boolean {
  return process.env.NODE_ENV === "production" && process.env.ALLOW_INSECURE_COOKIES !== "true";
}

/**
 * Правила для любой куки входа — и для сессии, и для одноразовых меток
 * шагов входа (метка Steam, токен Telegram). Различается только срок:
 * расходиться остальным этим кукам незачем.
 */
export function authCookieOptions(maxAgeSeconds: number): CookieOptions {
  return {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

/** Погасить куку: то же имя, пустое значение, нулевой срок. */
export const CLEAR_COOKIE_OPTIONS = { path: "/", maxAge: 0 } as const;

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

export function issueSessionCookie(accountId: number): SessionCookie {
  const expiresAt = Math.floor(Date.now() / 1000) + MAX_AGE;
  return {
    name: SESSION_COOKIE,
    value: `${accountId}.${expiresAt}.${sign(accountId, expiresAt)}`,
    options: authCookieOptions(MAX_AGE),
  };
}

/** Сравнение секретов без утечки по времени. */
export function timingSafeEqualStrings(a: string, b: string): boolean {
  // timingSafeEqual падает на разной длине, поэтому длину проверяем заранее.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Читает куку по имени из сырого заголовка Cookie.
 *
 * Граница имени обязательна: без неё `xgt_session=...` матчится раньше
 * настоящей куки, и любой, кто умеет поставить куку с длинным именем,
 * подменяет значение, на котором держится проверка.
 */
export function readCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = header.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`));
  return match ? match[1] : null;
}

export function verifySessionValue(value: string | null | undefined): number | null {
  if (!value) return null;
  const [rawId, rawExp, providedSig] = value.split(".");
  if (!rawId || !rawExp || !providedSig) return null;

  const accountId = Number(rawId);
  const expiresAt = Number(rawExp);
  if (!Number.isInteger(accountId) || accountId <= 0) return null;
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now() / 1000) return null;

  if (!timingSafeEqualStrings(sign(accountId, expiresAt), providedSig)) return null;

  return accountId;
}

/** Кто вошёл, по заголовкам запроса (маршруты API). */
export function readSessionFromRequest(req: Request): number | null {
  try {
    return verifySessionValue(readCookie(req.headers.get("cookie"), SESSION_COOKIE));
  } catch {
    // Не задан секрет — считаем, что не вошёл. Ошибка закрывает, а не открывает.
    return null;
  }
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
