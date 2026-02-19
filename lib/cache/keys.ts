export const CACHE_TTL = {
  appTags: 7 * 24 * 3600,      // 7 days
  appGenres: 7 * 24 * 3600,    // 7 days
  playerProfile: 3600,          // 1 hour
  ownedGames: 3600,             // 1 hour
  portrait: 24 * 3600,          // 24 hours
  aggregatedProfile: 24 * 3600, // 24 hours
  rateLimit: 3600,              // 1 hour
} as const;

export function portraitKey(steamId64: string, locale: string): string {
  return `portrait:${steamId64}:${locale}`;
}

export function profileKey(steamId64: string): string {
  return `profile:${steamId64}`;
}

export function rateLimitKey(ip: string): string {
  return `ratelimit:${ip}`;
}
