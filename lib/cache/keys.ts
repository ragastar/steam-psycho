export const CACHE_TTL = {
  appTags: 7 * 24 * 3600,      // 7 days
  appGenres: 7 * 24 * 3600,    // 7 days
  playerProfile: 3600,          // 1 hour
  ownedGames: 3600,             // 1 hour
  portrait: 24 * 3600,          // 24 hours
  aggregatedProfile: 24 * 3600, // 24 hours
  rateLimit: 3600,              // 1 hour
  gate: 24 * 3600,              // 24 hours
  artImage: 30 * 24 * 3600,    // 30 days
} as const;

export function portraitKey(steamId64: string, locale: string): string {
  return `portrait:v5:${steamId64}:${locale}`;
}

export function profileKey(steamId64: string): string {
  return `profile:v2:${steamId64}`;
}

export function rateLimitKey(ip: string): string {
  return `ratelimit:${ip}`;
}

export function gateTokenKey(token: string): string {
  return `gate:${token}`;
}

/**
 * Код входа, выданный ботом. Живёт минуты: это одноразовый пропуск,
 * а не сессия.
 */
export function loginCodeKey(code: string): string {
  return `logincode:${code}`;
}

/**
 * Попытки ввода кода с одного адреса. Отдельный ключ от rateLimitKey: у
 * разбора библиотеки потолок про деньги, а здесь — про перебор пропуска
 * в чужой аккаунт, и делить одну корзину им нельзя.
 */
export function loginAttemptKey(ip: string): string {
  return `ratelimit:logincode:${ip}`;
}

/**
 * Попытки начать покупку с одного адреса. Ключ отдельный от rateLimitKey
 * намеренно: там корзина про расход на модель (разбор библиотеки), а здесь про
 * мусор в базе заказов — каждая попытка пишет строку в тот же файл SQLite, где
 * лежат аккаунты и права. Потолки у них разные, и общая корзина означала бы,
 * что один расход съедает чужой.
 */
export function payCreateKey(ip: string): string {
  return `ratelimit:paycreate:${ip}`;
}

export function cardStatsKey(steamId64: string): string {
  return `cardstats:v1:${steamId64}`;
}

export function rarityKey(steamId64: string): string {
  return `rarity:v1:${steamId64}`;
}

export function artImageKey(steamId64: string): string {
  return `art:image:v1:${steamId64}`;
}
