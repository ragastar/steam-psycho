/**
 * Собирает боевой промпт для конкретного Steam-профиля и кладёт в файлы.
 *
 * Нужен, чтобы оценить качество любой модели вручную — своими средствами,
 * без подключения чего-либо к обработчику сайта. Данные настоящие: тот же
 * путь, что и в проде (резолв → Steam API → обогащение → агрегация).
 *
 *   npm run prompt:dump -- 76561197979911851 ru
 *
 * Дальше два файла из tmp/prompt-<id>/ скармливаешь любой модели руками.
 */

import fs from "fs";
import path from "path";
import {
  resolveToSteamId64,
  getPlayerSummary,
  getOwnedGames,
  getRecentlyPlayedGames,
  getSteamLevel,
  getFriendList,
  getBadges,
} from "../lib/steam/client";
import { enrichGames } from "../lib/steam/enrich";
import {
  buildAggregatedProfile,
  calculateCardStats,
  calculateRarity,
} from "../lib/aggregation/aggregate";
import { getSystemPrompt, buildUserPrompt } from "../lib/llm/prompt";
import type { OwnedGame } from "../lib/steam/types";

async function main() {
  const input = process.argv[2];
  const locale = process.argv[3] || "ru";

  if (!input) {
    console.error("Укажи Steam ID или ссылку на профиль:\n  npm run prompt:dump -- 76561197979911851 ru");
    process.exit(1);
  }
  if (!process.env.STEAM_API_KEY) {
    console.error("STEAM_API_KEY не задан. Запускай так:\n  set -a; . ./.env.local; set +a; npm run prompt:dump -- <id>");
    process.exit(1);
  }

  console.log(`Резолвлю ${input}…`);
  const steamId64 = await resolveToSteamId64(input);

  console.log("Тяну данные из Steam…");
  const [player, games, recent, level, friends, badges] = await Promise.all([
    getPlayerSummary(steamId64),
    getOwnedGames(steamId64),
    getRecentlyPlayedGames(steamId64).catch(() => [] as OwnedGame[]),
    getSteamLevel(steamId64).catch(() => 0),
    getFriendList(steamId64),
    getBadges(steamId64),
  ]);

  if (!games?.length) {
    console.error("Библиотека скрыта или пуста — на таком профиле портрет не построить.");
    process.exit(1);
  }

  console.log(`Игр: ${games.length}. Обогащаю (это самая долгая часть)…`);
  const enriched = await enrichGames(games);

  // Достижения пропускаем: они добавляют минуты, а на форму промпта влияют мало.
  const profile = buildAggregatedProfile(player, enriched, recent, level, friends, badges, []);
  const cardStats = calculateCardStats(profile);
  const rarity = calculateRarity(profile, null);

  const systemPrompt = getSystemPrompt(locale);
  const userPrompt = buildUserPrompt(profile, cardStats, rarity);

  const outDir = path.join(process.cwd(), "tmp", `prompt-${steamId64}`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "system.md"), systemPrompt);
  fs.writeFileSync(path.join(outDir, "user.md"), userPrompt);

  const approxTokens = (s: string) => Math.round(s.length / 3.5);

  console.log(`
Готово: ${outDir}
  system.md — ${systemPrompt.length} символов (~${approxTokens(systemPrompt)} токенов)
  user.md   — ${userPrompt.length} символов (~${approxTokens(userPrompt)} токенов)

Игрок: ${profile.player.name}, ${profile.stats.totalGames} игр, ${profile.stats.totalPlaytimeHours} ч, редкость ${rarity}
`);
}

main().catch((err) => {
  console.error("Не получилось:", err instanceof Error ? err.message : err);
  process.exit(1);
});
