import type { SteamPlayer, OwnedGame, EnrichedGame, SteamFriend, BadgesResponse, AchievementGameData } from "../steam/types";
import type { AggregatedProfile } from "./types";
import type { Rarity } from "../llm/types";

const MP_TAGS = new Set([
  "Multi-player", "Multiplayer", "Online Multi-Player",
  "Online PvP", "Online Co-Op", "Co-op", "MMO", "MMORPG",
  "PvP", "Battle Royale",
]);
const SP_TAGS = new Set([
  "Single-player", "Singleplayer",
]);
const INDIE_TAGS = new Set(["Indie"]);

export interface CardStats {
  dedication: number;
  mastery: number;
  exploration: number;
  hoarding: number;
  social: number;
  veteran: number;
}

// --- Economics ---
function calculateEconomics(games: EnrichedGame[]): AggregatedProfile["economics"] {
  let totalValue = 0;
  let wastedValue = 0;
  let freeCount = 0;
  let bestDeal: { name: string; pricePerHour: number } | null = null;

  const MIN_HOURS_FOR_PPH = 2; // Minimum 2 hours to calculate $/h

  for (const game of games) {
    if (game.isFree) {
      freeCount++;
      continue;
    }
    if (game.price === undefined) continue;
    const price = game.price;
    totalValue += price;
    if (game.playtime_forever === 0) {
      wastedValue += price;
    }
    // Only calculate $/h for games with 2+ hours — avoids absurd numbers
    const hours = game.playtime_forever / 60;
    if (price > 0 && hours >= MIN_HOURS_FOR_PPH) {
      const pph = price / hours;
      if (!bestDeal || pph < bestDeal.pricePerHour) {
        bestDeal = { name: game.name, pricePerHour: Math.round(pph * 100) / 100 };
      }
    }
  }

  const totalHours = games.reduce((a, g) => a + g.playtime_forever, 0) / 60;
  const perHourCost = totalHours > 0 ? Math.round((totalValue / totalHours) * 100) / 100 : 0;
  const freePercentage = games.length > 0 ? Math.round((freeCount / games.length) * 100) : 0;

  return {
    totalLibraryValue: Math.round(totalValue * 100) / 100,
    wastedValue: Math.round(wastedValue * 100) / 100,
    perHourCost,
    bestDeal,
    freePercentage,
  };
}

// --- Platforms ---
function calculatePlatforms(games: OwnedGame[]): AggregatedProfile["platforms"] {
  let win = 0, linux = 0, deck = 0;
  for (const g of games) {
    win += g.playtime_windows_forever || 0;
    linux += g.playtime_linux_forever || 0;
    // Steam Deck uses linux playtime but we separate if mac field present
    // In practice, playtime_linux_forever includes Deck
  }
  // Approximate: Deck = portion of linux playtime (heuristic)
  deck = Math.round(linux * 0.3); // rough estimate
  linux = linux - deck;

  const total = win + linux + deck;
  if (total === 0) return { windowsPercentage: 100, linuxPercentage: 0, deckPercentage: 0 };

  return {
    windowsPercentage: Math.round((win / total) * 100),
    linuxPercentage: Math.round((linux / total) * 100),
    deckPercentage: Math.round((deck / total) * 100),
  };
}

// --- Timeline ---
function calculateTimeline(
  player: SteamPlayer,
  games: EnrichedGame[],
  recentGames: OwnedGame[],
): AggregatedProfile["timeline"] {
  const now = Date.now() / 1000;
  // Account age based on oldest game or profile creation
  const accountAge = player.timecreated
    ? Math.round((now - player.timecreated) / (365.25 * 24 * 3600) * 10) / 10
    : 0;

  // Peak year estimation: look at game playtimes (heuristic since we don't have per-year data)
  // Use total hours / account age for average
  const totalHours = games.reduce((a, g) => a + g.playtime_forever, 0) / 60;
  const avgMonthlyHours = accountAge > 0 ? totalHours / (accountAge * 12) : 0;

  // Recent activity
  const recentHours = recentGames.reduce((a, g) => a + (g.playtime_2weeks || 0), 0) / 60;
  const currentMonthlyHours = Math.round(recentHours * 2 * 10) / 10; // 2 weeks → monthly

  let trend: "rising" | "stable" | "declining" | "inactive" = "stable";
  if (recentHours === 0) trend = "inactive";
  else if (currentMonthlyHours > avgMonthlyHours * 1.3) trend = "rising";
  else if (currentMonthlyHours < avgMonthlyHours * 0.5) trend = "declining";

  const lastActivityDate = player.lastlogoff
    ? new Date(player.lastlogoff * 1000).toISOString().split("T")[0]
    : null;

  return {
    accountAge,
    peakYear: null, // Not reliably determinable from available data
    peakMonthlyHours: Math.round(avgMonthlyHours * 1.5 * 10) / 10, // estimate
    currentMonthlyHours,
    trend,
    lastActivityDate,
  };
}

// --- Social ---
function calculateSocial(friends: SteamFriend[]): AggregatedProfile["social"] {
  if (friends.length === 0) {
    return { friendsCount: 0, oldestFriend: null, newestFriend: null, friendsAddedPerYear: 0 };
  }

  const sorted = [...friends].sort((a, b) => a.friend_since - b.friend_since);
  const oldest = sorted[0];
  const newest = sorted[sorted.length - 1];

  const now = Date.now() / 1000;
  const accountSpanYears = oldest ? (now - oldest.friend_since) / (365.25 * 24 * 3600) : 1;
  const friendsAddedPerYear = accountSpanYears > 0
    ? Math.round((friends.length / accountSpanYears) * 10) / 10
    : friends.length;

  return {
    friendsCount: friends.length,
    oldestFriend: oldest ? { steamid: oldest.steamid, since: oldest.friend_since } : null,
    newestFriend: newest ? { steamid: newest.steamid, since: newest.friend_since } : null,
    friendsAddedPerYear,
  };
}

// --- Achievements ---
function calculateAchievements(achievementsData: AchievementGameData[]): AggregatedProfile["achievements"] {
  const topGames = achievementsData
    .filter((g) => g.achievements.length > 0)
    .map((g) => {
      const total = g.achievements.length;
      const achieved = g.achievements.filter((a) => a.achieved === 1).length;
      const completionRate = total > 0 ? Math.round((achieved / total) * 100) : 0;

      // Find rarest achieved achievement
      const achievedNames = new Set(
        g.achievements.filter((a) => a.achieved === 1).map((a) => a.apiname),
      );
      let rarest: { name: string; percent: number } | null = null;
      for (const ga of g.globalAchievements) {
        if (achievedNames.has(ga.name)) {
          if (!rarest || ga.percent < rarest.percent) {
            rarest = { name: ga.name, percent: Math.round(ga.percent * 10) / 10 };
          }
        }
      }

      return { name: g.name, completionRate, rarest };
    })
    .sort((a, b) => b.completionRate - a.completionRate)
    .slice(0, 5);

  return { topGames };
}

// --- Badges ---
function calculateBadges(badgesResponse: BadgesResponse | null): AggregatedProfile["badges"] {
  if (!badgesResponse || badgesResponse.badges.length === 0) {
    return { totalCount: 0, rarestBadge: null, totalXP: 0 };
  }

  const sorted = [...badgesResponse.badges].sort((a, b) => a.scarcity - b.scarcity);
  const rarest = sorted[0];

  return {
    totalCount: badgesResponse.badges.length,
    rarestBadge: rarest ? { badgeid: rarest.badgeid, scarcity: rarest.scarcity } : null,
    totalXP: badgesResponse.player_xp,
  };
}

// --- Patterns ---
function calculatePatterns(
  games: EnrichedGame[],
  genreDistribution: { genre: string; percentage: number }[],
): AggregatedProfile["patterns"] {
  const genreConcentration = genreDistribution.length > 0 ? genreDistribution[0].percentage : 0;

  // Binge style: high concentration = binger, low = sampler
  const top3Playtime = [...games]
    .sort((a, b) => b.playtime_forever - a.playtime_forever)
    .slice(0, 3)
    .reduce((a, g) => a + g.playtime_forever, 0);
  const totalPlaytime = games.reduce((a, g) => a + g.playtime_forever, 0);
  const top3Ratio = totalPlaytime > 0 ? top3Playtime / totalPlaytime : 0;

  let bingeStyle: "binger" | "sampler" | "balanced" = "balanced";
  if (top3Ratio > 0.7) bingeStyle = "binger";
  else if (top3Ratio < 0.3) bingeStyle = "sampler";

  // Indie percentage
  let indieCount = 0;
  for (const g of games) {
    const allTags = [...Object.keys(g.tags), ...g.genres];
    if (allTags.some((t) => INDIE_TAGS.has(t))) indieCount++;
  }
  const indiePercentage = games.length > 0 ? Math.round((indieCount / games.length) * 100) : 0;

  return {
    genreConcentration,
    bingeStyle,
    indiePercentage,
    medianReleaseYear: null, // Would need store API release_date data
  };
}

// --- Ranks (approximate percentiles) ---
function calculateRanks(
  totalHours: number,
  totalGames: number,
  concentrationRatio: number,
  accountAge: number,
): AggregatedProfile["ranks"] {
  // Rough percentile estimates based on typical Steam user distributions
  function hoursPercentile(h: number): number {
    if (h >= 10000) return 99;
    if (h >= 5000) return 95;
    if (h >= 2000) return 85;
    if (h >= 1000) return 70;
    if (h >= 500) return 50;
    if (h >= 200) return 30;
    if (h >= 50) return 15;
    return 5;
  }

  function libPercentile(g: number): number {
    if (g >= 2000) return 99;
    if (g >= 1000) return 95;
    if (g >= 500) return 85;
    if (g >= 200) return 70;
    if (g >= 100) return 50;
    if (g >= 50) return 30;
    return 10;
  }

  function concPercentile(c: number): number {
    if (c >= 90) return 95;
    if (c >= 70) return 80;
    if (c >= 50) return 60;
    if (c >= 30) return 40;
    return 20;
  }

  function vetPercentile(age: number): number {
    if (age >= 18) return 99;
    if (age >= 15) return 95;
    if (age >= 10) return 80;
    if (age >= 7) return 60;
    if (age >= 4) return 40;
    return 20;
  }

  return {
    hoursPercentile: hoursPercentile(totalHours),
    librarySizePercentile: libPercentile(totalGames),
    concentrationPercentile: concPercentile(concentrationRatio),
    veteranPercentile: vetPercentile(accountAge),
  };
}

// --- Card Stats (6 stats) ---
export function calculateCardStats(profile: AggregatedProfile): CardStats {
  // dedication: total hours + low unplayed %
  const hoursNorm = Math.min(profile.stats.totalPlaytimeHours / 5000, 1);
  const playedNorm = 1 - profile.stats.unplayedPercentage / 100;
  const dedication = Math.round(hoursNorm * 60 + playedNorm * 40);

  // mastery: concentration + achievement completion + avg hours per played game
  const concNorm = Math.min(profile.concentrationRatio / 80, 1);
  const avgNorm = Math.min(profile.stats.avgPlaytimeHours / 50, 1);
  const achvAvg = profile.achievements.topGames.length > 0
    ? profile.achievements.topGames.reduce((a, g) => a + g.completionRate, 0) / profile.achievements.topGames.length / 100
    : 0;
  const mastery = Math.round(concNorm * 40 + avgNorm * 30 + achvAvg * 30);

  // exploration: library size + genre diversity + low concentration
  const libNorm = Math.min(profile.stats.totalGames / 500, 1);
  const genreDiversity = Math.min(profile.genreDistribution.length / 10, 1);
  const lowConc = 1 - Math.min(profile.concentrationRatio / 100, 1);
  const exploration = Math.round(libNorm * 40 + genreDiversity * 30 + lowConc * 30);

  // hoarding: unplayed % + library size
  const unplayedNorm = profile.stats.unplayedPercentage / 100;
  const hoarding = Math.round(unplayedNorm * 60 + libNorm * 40);

  // social: friends count + multiplayer ratio
  const friendsNorm = Math.min(profile.social.friendsCount / 200, 1);
  const mpNorm = profile.multiplayerRatio / 100;
  const social = Math.round(friendsNorm * 50 + mpNorm * 50);

  // veteran: account age + steam level + badge count
  const ageNorm = Math.min(profile.timeline.accountAge / 15, 1);
  const levelNorm = Math.min(profile.player.steamLevel / 100, 1);
  const badgeNorm = Math.min(profile.badges.totalCount / 50, 1);
  const veteran = Math.round(ageNorm * 50 + levelNorm * 30 + badgeNorm * 20);

  const clamp = (v: number) => Math.min(Math.max(v, 0), 100);
  return {
    dedication: clamp(dedication),
    mastery: clamp(mastery),
    exploration: clamp(exploration),
    hoarding: clamp(hoarding),
    social: clamp(social),
    veteran: clamp(veteran),
  };
}

// --- Rarity ---
export function calculateRarity(profile: AggregatedProfile): Rarity {
  const hours = profile.stats.totalPlaytimeHours;
  const games = profile.stats.totalGames;
  const level = profile.player.steamLevel;

  const score = hours * 0.4 + games * 0.3 + level * 0.3;

  if (score >= 1000) return "legendary";
  if (score >= 600) return "epic";
  if (score >= 300) return "rare";
  if (score >= 100) return "uncommon";
  return "common";
}

// --- Main Builder ---
export function buildAggregatedProfile(
  player: SteamPlayer,
  games: EnrichedGame[],
  recentGames: OwnedGame[],
  steamLevel: number,
  friends: SteamFriend[],
  badgesResponse: BadgesResponse | null,
  achievementsData: AchievementGameData[],
): AggregatedProfile {
  const totalGames = games.length;
  const playtimes = games.map((g) => g.playtime_forever);
  const totalMinutes = playtimes.reduce((a, b) => a + b, 0);
  const totalHours = Math.round((totalMinutes / 60) * 10) / 10;

  const playedGames = games.filter((g) => g.playtime_forever > 0);
  const unplayedCount = totalGames - playedGames.length;

  const sortedPlaytimes = [...playtimes].filter((p) => p > 0).sort((a, b) => a - b);
  const median = sortedPlaytimes.length > 0
    ? sortedPlaytimes[Math.floor(sortedPlaytimes.length / 2)] / 60
    : 0;

  // Top games with enriched data
  const sorted = [...games].sort((a, b) => b.playtime_forever - a.playtime_forever);

  // Build achievement lookup
  const achvLookup = new Map<number, AchievementGameData>();
  for (const ad of achievementsData) {
    achvLookup.set(ad.appid, ad);
  }

  const top10 = sorted.slice(0, 10).map((g) => {
    const playtimeHours = Math.round((g.playtime_forever / 60) * 10) / 10;
    const avgForeverHours = g.averageForever ? g.averageForever / 60 : undefined;
    const vsAverage = avgForeverHours && avgForeverHours > 0
      ? Math.round((playtimeHours / avgForeverHours) * 10) / 10
      : undefined;
    const pricePerHour = g.price && playtimeHours > 0
      ? Math.round((g.price / playtimeHours) * 100) / 100
      : undefined;

    const achvData = achvLookup.get(g.appid);
    let achievementRate: number | undefined;
    if (achvData && achvData.achievements.length > 0) {
      const achieved = achvData.achievements.filter((a) => a.achieved === 1).length;
      achievementRate = Math.round((achieved / achvData.achievements.length) * 100);
    }

    return {
      name: g.name,
      appid: g.appid,
      playtimeHours,
      tags: Object.keys(g.tags).slice(0, 10),
      genres: g.genres,
      iconUrl: g.img_icon_url,
      vsAverage,
      isFree: g.isFree,
      pricePerHour,
      achievementRate,
    };
  });

  // Concentration ratio
  const top3Minutes = sorted.slice(0, 3).reduce((a, g) => a + g.playtime_forever, 0);
  const concentrationRatio = totalMinutes > 0
    ? Math.round((top3Minutes / totalMinutes) * 100)
    : 0;

  // Genre distribution
  const genreScores: Record<string, number> = {};
  for (const game of games) {
    if (game.genres.length === 0 || game.playtime_forever === 0) continue;
    const perGenre = game.playtime_forever / game.genres.length;
    for (const genre of game.genres) {
      genreScores[genre] = (genreScores[genre] || 0) + perGenre;
    }
  }
  const totalGenreScore = Object.values(genreScores).reduce((a, b) => a + b, 0);
  const genreDistribution = Object.entries(genreScores)
    .map(([genre, score]) => ({
      genre,
      percentage: totalGenreScore > 0 ? Math.round((score / totalGenreScore) * 100) : 0,
    }))
    .sort((a, b) => b.percentage - a.percentage)
    .slice(0, 10);

  // Tag distribution
  const tagScores: Record<string, number> = {};
  for (const game of games) {
    const tagEntries = Object.entries(game.tags);
    if (tagEntries.length === 0 || game.playtime_forever === 0) continue;
    const totalWeight = tagEntries.reduce((a, [, w]) => a + w, 0);
    if (totalWeight === 0) continue;
    for (const [tag, weight] of tagEntries) {
      tagScores[tag] = (tagScores[tag] || 0) + (weight / totalWeight) * game.playtime_forever;
    }
  }
  const totalTagScore = Object.values(tagScores).reduce((a, b) => a + b, 0);
  const tagDistribution = Object.entries(tagScores)
    .map(([tag, score]) => ({
      tag,
      percentage: totalTagScore > 0 ? Math.round((score / totalTagScore) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.percentage - a.percentage)
    .slice(0, 20);

  // MP/SP ratio
  let mpTime = 0;
  let spTime = 0;
  for (const game of games) {
    const allTags = [...Object.keys(game.tags), ...game.genres];
    const isMP = allTags.some((t) => MP_TAGS.has(t));
    const isSP = allTags.some((t) => SP_TAGS.has(t));
    if (isMP) mpTime += game.playtime_forever;
    if (isSP) spTime += game.playtime_forever;
  }
  const mpSpTotal = mpTime + spTime;
  const multiplayerRatio = mpSpTotal > 0 ? Math.round((mpTime / mpSpTotal) * 100) : 50;
  const singleplayerRatio = 100 - multiplayerRatio;

  const avgPlaytimeHours = playedGames.length > 0
    ? Math.round((totalHours / playedGames.length) * 10) / 10
    : 0;

  const recentHours = recentGames.reduce((a, g) => a + (g.playtime_2weeks || 0), 0) / 60;

  const economics = calculateEconomics(games);
  const platforms = calculatePlatforms(games);
  const timeline = calculateTimeline(player, games, recentGames);
  const socialData = calculateSocial(friends);
  const achievementsResult = calculateAchievements(achievementsData);
  const badgesResult = calculateBadges(badgesResponse);
  const patterns = calculatePatterns(games, genreDistribution);
  const ranks = calculateRanks(totalHours, totalGames, concentrationRatio, timeline.accountAge);

  return {
    player: {
      name: player.personaname,
      avatar: player.avatarfull,
      steamLevel,
      steamId64: player.steamid,
      profileUrl: player.profileurl,
      accountAge: timeline.accountAge,
      lastLogoff: player.lastlogoff,
    },
    stats: {
      totalGames,
      totalPlaytimeHours: totalHours,
      avgPlaytimeHours,
      medianPlaytimeHours: Math.round(median * 10) / 10,
      unplayedCount,
      unplayedPercentage: totalGames > 0
        ? Math.round((unplayedCount / totalGames) * 100)
        : 0,
    },
    topGames: top10,
    genreDistribution,
    tagDistribution,
    concentrationRatio,
    multiplayerRatio,
    singleplayerRatio,
    recentActivity: {
      gamesPlayed2Weeks: recentGames.length,
      hoursPlayed2Weeks: Math.round(recentHours * 10) / 10,
      recentGameNames: recentGames.map((g) => g.name),
    },
    economics,
    platforms,
    timeline,
    social: socialData,
    achievements: achievementsResult,
    badges: badgesResult,
    patterns,
    ranks,
  };
}
