import type { AggregatedProfile } from "../aggregation/types";

/**
 * То, что можно показать до открытия доступа.
 *
 * Раньше сервер отдавал в браузер весь профиль и весь портрет, а закрытую часть
 * компонент размывал средствами оформления — всё читалось в исходнике страницы.
 * Теперь наружу уходит только эта горстка полей.
 */
export interface TeaserProfile {
  /**
   * Метка «это урезанный профиль», и без неё защита была бы на честном слове.
   *
   * У `AggregatedProfile` есть ВСЕ поля витрины, а лишние свойства TypeScript
   * отбрасывает молча — у всего, кроме литералов. Поэтому до этого поля
   * `profile={profile}` вместо `profile={toTeaserProfile(profile)}` собиралось
   * без единой ошибки, и в браузер уезжали бы игры, друзья, ачивки и экономика:
   * `npm run verify` при этом остаётся зелёным, а перепроверять никто не пойдёт.
   * Проставляет её только `toTeaserProfile`, поэтому полный профиль сюда больше
   * не присваивается. Сносить поле как мусор нельзя — оно и есть замок.
   */
  readonly __teaser: true;
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
    __teaser: true,
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
