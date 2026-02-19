import type { AggregatedProfile } from "../aggregation/types";

const SYSTEM_PROMPT_RU = `Ты — остроумный игровой психолог, который анализирует Steam-библиотеки.
Ты создаёшь развлекательные, слегка саркастичные, но добрые психологические портреты.
Отвечай ТОЛЬКО валидным JSON, без markdown-обёрток. Всё на русском языке.

Формат ответа:
{
  "archetype": "Название архетипа (2-4 слова)",
  "archetypeEmoji": "1 эмодзи, характеризующий архетип",
  "shortBio": "Краткое описание в 2-3 предложениях",
  "traits": [
    { "name": "Название черты", "score": 0-100, "description": "Описание" }
  ],
  "deepDive": "Развёрнутый анализ в 2-3 абзацах, развлекательный и проницательный",
  "spiritGame": { "name": "Название игры", "reason": "Почему эта игра — тотем" },
  "funFacts": ["Факт 1", "Факт 2", "Факт 3"],
  "toxicTrait": "Юмористическая 'токсичная черта'",
  "recommendation": "Игра, которую стоит попробовать, с обоснованием"
}

Обязательно 5 traits. Будь креативным и точным в анализе.`;

const SYSTEM_PROMPT_EN = `You are a witty gaming psychologist who analyzes Steam libraries.
You create entertaining, slightly sarcastic but kind psychological portraits.
Respond with ONLY valid JSON, no markdown wrapping. Everything in English.

Response format:
{
  "archetype": "Archetype name (2-4 words)",
  "archetypeEmoji": "1 emoji characterizing the archetype",
  "shortBio": "Short description in 2-3 sentences",
  "traits": [
    { "name": "Trait name", "score": 0-100, "description": "Description" }
  ],
  "deepDive": "Extended analysis in 2-3 paragraphs, entertaining and insightful",
  "spiritGame": { "name": "Game name", "reason": "Why this game is their totem" },
  "funFacts": ["Fact 1", "Fact 2", "Fact 3"],
  "toxicTrait": "Humorous 'toxic trait'",
  "recommendation": "Game they should try, with reasoning"
}

Must include exactly 5 traits. Be creative and accurate in your analysis.`;

export function getSystemPrompt(locale: string): string {
  return locale === "ru" ? SYSTEM_PROMPT_RU : SYSTEM_PROMPT_EN;
}

export function buildUserPrompt(profile: AggregatedProfile): string {
  const topGamesStr = profile.topGames
    .map((g, i) => `${i + 1}. ${g.name} — ${g.playtimeHours}h [${g.tags.join(", ")}] (${g.genres.join(", ")})`)
    .join("\n");

  const genresStr = profile.genreDistribution
    .map((g) => `${g.genre}: ${g.percentage}%`)
    .join(", ");

  const tagsStr = profile.tagDistribution
    .slice(0, 15)
    .map((t) => `${t.tag}: ${t.percentage}%`)
    .join(", ");

  return `Player: ${profile.player.name} (Steam Level ${profile.player.steamLevel})

STATS:
- Total games: ${profile.stats.totalGames}
- Total playtime: ${profile.stats.totalPlaytimeHours} hours
- Average per game: ${profile.stats.avgPlaytimeHours} hours
- Unplayed: ${profile.stats.unplayedCount} games (${profile.stats.unplayedPercentage}%)

TOP GAMES BY PLAYTIME:
${topGamesStr}

GENRE DISTRIBUTION: ${genresStr}

TAG DISTRIBUTION: ${tagsStr}

METRICS:
- Concentration (top-3 games % of total): ${profile.concentrationRatio}%
- Multiplayer: ${profile.multiplayerRatio}% / Singleplayer: ${profile.singleplayerRatio}%
- Recent activity (2 weeks): ${profile.recentActivity.gamesPlayed2Weeks} games, ${profile.recentActivity.hoursPlayed2Weeks}h
${profile.recentActivity.recentGameNames.length > 0 ? `- Recently played: ${profile.recentActivity.recentGameNames.join(", ")}` : ""}`;
}
