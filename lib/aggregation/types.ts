export interface AggregatedProfile {
  player: {
    name: string;
    avatar: string;
    steamLevel: number;
    steamId64: string;
    profileUrl: string;
    accountAge?: number; // years
    lastLogoff?: number;
    countryCode?: string;
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
    vsAverage?: number; // multiplier vs global average
    isFree?: boolean;
    pricePerHour?: number;
    achievementRate?: number; // 0-100
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
  economics: {
    totalLibraryValue: number;
    wastedValue: number; // value of unplayed games
    perHourCost: number;
    bestDeal: { name: string; pricePerHour: number } | null;
    freePercentage: number;
  };
  platforms: {
    windowsPercentage: number;
    linuxPercentage: number;
    deckPercentage: number;
  };
  timeline: {
    accountAge: number; // years
    peakYear: number | null;
    peakMonthlyHours: number;
    currentMonthlyHours: number;
    trend: "rising" | "stable" | "declining" | "inactive";
    lastActivityDate: string | null;
  };
  social: {
    friendsCount: number;
    oldestFriend: { steamid: string; since: number } | null;
    newestFriend: { steamid: string; since: number } | null;
    friendsAddedPerYear: number;
  };
  achievements: {
    topGames: {
      name: string;
      completionRate: number;
      rarest: { name: string; percent: number } | null;
    }[];
  };
  badges: {
    totalCount: number;
    rarestBadge: { badgeid: number; scarcity: number } | null;
    totalXP: number;
  };
  patterns: {
    genreConcentration: number; // top-1 genre % of total
    bingeStyle: "binger" | "sampler" | "balanced";
    indiePercentage: number;
    medianReleaseYear: number | null;
  };
  ranks: {
    hoursPercentile: number;
    librarySizePercentile: number;
    concentrationPercentile: number;
    veteranPercentile: number;
  };
}
