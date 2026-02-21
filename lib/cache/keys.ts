export const CACHE_TTL = {
  appTags: 7 * 24 * 3600,      // 7 days
  appGenres: 7 * 24 * 3600,    // 7 days
  playerProfile: 3600,          // 1 hour
  ownedGames: 3600,             // 1 hour
  portrait: 24 * 3600,          // 24 hours
  aggregatedProfile: 24 * 3600, // 24 hours
  rateLimit: 3600,              // 1 hour
  gate: 3600,                   // 1 hour
  artImage: 30 * 24 * 3600,    // 30 days
} as const;

export function portraitKey(steamId64: string, locale: string): string {
  return `portrait:v3:${steamId64}:${locale}`;
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

export function artImageKey(steamId64: string): string {
  return `art:image:v1:${steamId64}`;
}
