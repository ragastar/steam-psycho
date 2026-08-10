import type { AggregatedProfile } from "../aggregation/types";

/**
 * То, что можно показать до открытия доступа.
 *
 * Раньше сервер отдавал в браузер весь профиль и весь портрет, а закрытую часть
 * компонент размывал средствами оформления — всё читалось в исходнике страницы.
 * Теперь наружу уходит только эта горстка полей.
 */
export interface TeaserProfile {
  player: {
    name: string;
    avatar: string;
    steamLevel: number;
  };
  stats: {
    totalGames: number;
    totalPlaytimeHours: number;
  };
}

export function toTeaserProfile(profile: AggregatedProfile): TeaserProfile {
  return {
    player: {
      name: profile.player.name,
      avatar: profile.player.avatar,
      steamLevel: profile.player.steamLevel,
    },
    stats: {
      totalGames: profile.stats.totalGames,
      totalPlaytimeHours: profile.stats.totalPlaytimeHours,
    },
  };
}
