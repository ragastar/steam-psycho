import type { SteamPlayer, OwnedGame, EnrichedGame } from "../steam/types";
import type { AggregatedProfile } from "./types";

const MP_TAGS = new Set([
  "Multi-player", "Multiplayer", "Online Multi-Player",
  "Online PvP", "Online Co-Op", "Co-op", "MMO", "MMORPG",
  "PvP", "Battle Royale",
]);
const SP_TAGS = new Set([
  "Single-player", "Singleplayer",
]);

export function buildAggregatedProfile(
  player: SteamPlayer,
  games: EnrichedGame[],
  recentGames: OwnedGame[],
  steamLevel: number,
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

  // Top games
  const sorted = [...games].sort((a, b) => b.playtime_forever - a.playtime_forever);
  const top10 = sorted.slice(0, 10).map((g) => ({
    name: g.name,
    appid: g.appid,
    playtimeHours: Math.round((g.playtime_forever / 60) * 10) / 10,
    tags: Object.keys(g.tags).slice(0, 10),
    genres: g.genres,
    iconUrl: g.img_icon_url,
  }));

  // Concentration ratio
  const top3Minutes = sorted.slice(0, 3).reduce((a, g) => a + g.playtime_forever, 0);
  const concentrationRatio = totalMinutes > 0
    ? Math.round((top3Minutes / totalMinutes) * 100)
    : 0;

  // Genre distribution (weighted by playtime)
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

  // Tag distribution (weighted by tag weight * playtime)
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

  // Multiplayer vs Singleplayer ratio
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

  // Recent activity
  const recentHours = recentGames.reduce((a, g) => a + (g.playtime_2weeks || 0), 0) / 60;

  return {
    player: {
      name: player.personaname,
      avatar: player.avatarfull,
      steamLevel,
      steamId64: player.steamid,
    },
    stats: {
      totalGames,
      totalPlaytimeHours: totalHours,
      avgPlaytimeHours: playedGames.length > 0
        ? Math.round((totalHours / playedGames.length) * 10) / 10
        : 0,
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
  };
}
