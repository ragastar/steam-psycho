export interface SteamPlayer {
  steamid: string;
  personaname: string;
  profileurl: string;
  avatarfull: string;
  communityvisibilitystate: number; // 3 = public
  personastate: number;
  lastlogoff?: number;
  timecreated?: number;
  loccountrycode?: string;
  gameextrainfo?: string; // currently playing
  gameid?: string;
}

export interface OwnedGame {
  appid: number;
  name: string;
  playtime_forever: number; // minutes
  playtime_2weeks?: number; // minutes
  playtime_windows_forever?: number;
  playtime_mac_forever?: number;
  playtime_linux_forever?: number;
  img_icon_url: string;
}

export interface EnrichedGame extends OwnedGame {
  tags: Record<string, number>; // tag name -> weight
  genres: string[];
  price?: number;
  isFree?: boolean;
  averageForever?: number; // global average playtime (minutes)
}

export interface PlayerAchievement {
  apiname: string;
  achieved: number; // 0 or 1
  unlocktime: number;
}

export interface GlobalAchievement {
  name: string;
  percent: number;
}

export interface SteamFriend {
  steamid: string;
  relationship: string;
  friend_since: number;
}

export interface Badge {
  badgeid: number;
  level: number;
  completion_time: number;
  xp: number;
  scarcity: number;
}

export interface BadgesResponse {
  badges: Badge[];
  player_xp: number;
  player_level: number;
}

export interface AchievementGameData {
  appid: number;
  name: string;
  achievements: PlayerAchievement[];
  globalAchievements: GlobalAchievement[];
}

export interface SteamSpyAppData {
  appid: number;
  name: string;
  developer: string;
  publisher: string;
  owners: string;
  average_forever: number;
  tags: Record<string, number>;
}

export interface StoreAppDetails {
  type: string;
  name: string;
  genres?: { id: string; description: string }[];
  categories?: { id: number; description: string }[];
  short_description?: string;
  developers?: string[];
  publishers?: string[];
  release_date?: { coming_soon: boolean; date: string };
}

export type SteamInputType = "profileUrl" | "vanityUrl" | "steamId64" | "vanityName";

export interface ResolvedInput {
  type: SteamInputType;
  value: string;
}

export class SteamApiError extends Error {
  constructor(
    message: string,
    public code:
      | "INVALID_INPUT"
      | "PROFILE_NOT_FOUND"
      | "PRIVATE_PROFILE"
      | "EMPTY_LIBRARY"
      | "STEAM_UNAVAILABLE"
      | "RATE_LIMITED",
  ) {
    super(message);
    this.name = "SteamApiError";
  }
}
