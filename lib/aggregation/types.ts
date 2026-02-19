export interface AggregatedProfile {
  player: {
    name: string;
    avatar: string;
    steamLevel: number;
    steamId64: string;
  };
  stats: {
    totalGames: number;
    totalPlaytimeHours: number;
    avgPlaytimeHours: number;
    medianPlaytimeHours: number;
    unplayedCount: number;
    unplayedPercentage: number;
  };
  topGames: {
    name: string;
    appid: number;
    playtimeHours: number;
    tags: string[];
    genres: string[];
    iconUrl: string;
  }[];
  genreDistribution: {
    genre: string;
    percentage: number;
  }[];
  tagDistribution: {
    tag: string;
    percentage: number;
  }[];
  concentrationRatio: number;
  multiplayerRatio: number;
  singleplayerRatio: number;
  recentActivity: {
    gamesPlayed2Weeks: number;
    hoursPlayed2Weeks: number;
    recentGameNames: string[];
  };
}
