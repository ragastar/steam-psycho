import type {
  SteamPlayer,
  EnrichedGame,
  OwnedGame,
  SteamFriend,
  BadgesResponse,
  AchievementGameData,
} from "@/lib/steam/types";

const YEAR = 365.25 * 24 * 3600;

export function player(over: Partial<SteamPlayer> = {}): SteamPlayer {
  return {
    steamid: "76561198000000001",
    personaname: "Тестовый Задрот",
    profileurl: "https://steamcommunity.com/id/test/",
    avatarfull: "https://avatars.steamstatic.com/x_full.jpg",
    communityvisibilitystate: 3,
    personastate: 1,
    timecreated: Math.floor(Date.now() / 1000 - 10 * YEAR),
    lastlogoff: Math.floor(Date.now() / 1000 - 3600),
    ...over,
  };
}

/** Игра с заполненными тегами/жанрами — как после обогащения топ-30. */
export function game(over: Partial<EnrichedGame> = {}): EnrichedGame {
  return {
    appid: 1,
    name: "Test Game",
    playtime_forever: 600,
    playtime_windows_forever: 600,
    img_icon_url: "icon",
    tags: { Action: 100 },
    genres: ["Action"],
    price: 20,
    isFree: false,
    ...over,
  };
}

/** Игра без тегов/жанров — как всё, что за пределами топ-30. */
export function bareGame(over: Partial<EnrichedGame> = {}): EnrichedGame {
  return game({ tags: {}, genres: [], price: undefined, ...over });
}

export function friend(over: Partial<SteamFriend> = {}): SteamFriend {
  return {
    steamid: "76561198000000002",
    relationship: "friend",
    friend_since: Math.floor(Date.now() / 1000 - 2 * YEAR),
    ...over,
  };
}

export const noBadges: BadgesResponse = { badges: [], player_xp: 0, player_level: 0 };
export const noAchievements: AchievementGameData[] = [];
export const noRecent: OwnedGame[] = [];

export { YEAR };
