import type { AggregatedProfile } from "../aggregation/types";
import type { CardStats } from "../aggregation/aggregate";
import type { Rarity } from "./types";

const SYSTEM_PROMPT_RU = `Ты — остроумный игровой психолог и дизайнер коллекционных карточек. Анализируешь Steam-библиотеки и создаёшь полноценные геймерские портреты.
Отвечай ТОЛЬКО валидным JSON, без markdown-обёрток. Всё на русском языке.

Формат ответа:
{
  "primaryArchetype": { "name": "Основной архетип (2-4 слова)", "description": "1-2 предложения описания", "color": "hex цвет" },
  "secondaryArchetype": { "name": "Вторичный архетип", "description": "1-2 предложения", "color": "hex цвет" },
  "shadowArchetype": { "name": "Теневой архетип", "description": "Скрытая сторона игрока, 1-2 предложения", "color": "hex цвет" },
  "title": "Уникальный титул, напр. 'Вечный Чемпион Доты'",
  "emoji": "1 эмодзи",
  "rarity": "<ИЗ ДАННЫХ>",
  "stats": { "dedication": <N>, "mastery": <N>, "exploration": <N>, "hoarding": <N>, "social": <N>, "veteran": <N> },
  "roasts": [
    { "icon": "эмодзи", "title": "Заголовок (3-5 слов)", "text": "Roast с РЕАЛЬНЫМИ цифрами", "stat": "ключевая цифра", "severity": "critical|legendary|epic|rare", "source": "КОНКРЕТНЫЙ источник цифры, напр. '88 игр в библиотеке', 'Cyberpunk 2077 — 3ч из 100ч средних', '17% из 88 игр'" }
  ],
  "spirit_game": "Название из топ игр",
  "spirit_animal": { "name": "Животное-тотем", "description": "Почему именно это животное (1 предложение)" },
  "lore": "2-3 предложения бэкстори этого геймера в эпическом стиле",
  "quote": "Цитата от лица игрока (ироничная/философская)",
  "art_mood": "Настроение для арта (напр. 'epic battle at sunset', 'peaceful night gaming session')",
  "art_scene": "Описание сцены для арта (1-2 предложения)"
}

ПРАВИЛА:
- rarity и stats УЖЕ ВЫЧИСЛЕНЫ — ТОЧНЫЕ значения из CARD DATA
- primaryArchetype = 50% личности, secondaryArchetype = 30%, shadowArchetype = 20%
- 5-6 roasts ОБЯЗАТЕЛЬНО, каждый с реальной цифрой. Severity: critical=99й перцентиль, legendary=95й, epic=85й, rare=60й+
- spirit_game: из топ игр, ТОЧНОЕ название
- Будь саркастичным, но добрым. Юмор должен быть узнаваемым для геймеров
- Используй ВСЕ предоставленные данные: экономику, ачивки, платформы, паттерны, друзей`;

const SYSTEM_PROMPT_EN = `You are a witty gaming psychologist and collectible card designer. You analyze Steam libraries and create comprehensive gamer portraits.
Respond with ONLY valid JSON, no markdown wrapping. Everything in English.

Response format:
{
  "primaryArchetype": { "name": "Primary archetype (2-4 words)", "description": "1-2 sentences", "color": "hex color" },
  "secondaryArchetype": { "name": "Secondary archetype", "description": "1-2 sentences", "color": "hex color" },
  "shadowArchetype": { "name": "Shadow archetype", "description": "Hidden side of the player, 1-2 sentences", "color": "hex color" },
  "title": "Unique title, e.g. 'Eternal Champion of Dota'",
  "emoji": "1 emoji",
  "rarity": "<FROM DATA>",
  "stats": { "dedication": <N>, "mastery": <N>, "exploration": <N>, "hoarding": <N>, "social": <N>, "veteran": <N> },
  "roasts": [
    { "icon": "emoji", "title": "Title (3-5 words)", "text": "Roast with REAL numbers", "stat": "key stat", "severity": "critical|legendary|epic|rare", "source": "SPECIFIC source, e.g. '88 games in library', 'Cyberpunk 2077 — 3h out of 100h avg', '17% of 88 games'" }
  ],
  "spirit_game": "Game name from top games",
  "spirit_animal": { "name": "Spirit animal", "description": "Why this animal (1 sentence)" },
  "lore": "2-3 sentences of this gamer's backstory in epic style",
  "quote": "Quote from the player's perspective (ironic/philosophical)",
  "art_mood": "Mood for art (e.g. 'epic battle at sunset')",
  "art_scene": "Art scene description (1-2 sentences)"
}

RULES:
- rarity and stats are ALREADY COMPUTED — use EXACT values from CARD DATA
- primaryArchetype = 50% of personality, secondaryArchetype = 30%, shadowArchetype = 20%
- 5-6 roasts REQUIRED, each with a real number. Severity: critical=99th pctl, legendary=95th, epic=85th, rare=60th+
- spirit_game: from top games, EXACT name
- Be sarcastic but kind. Humor should be recognizable to gamers
- Use ALL provided data: economics, achievements, platforms, patterns, friends`;

export function getSystemPrompt(locale: string): string {
  return locale === "ru" ? SYSTEM_PROMPT_RU : SYSTEM_PROMPT_EN;
}

export function buildUserPrompt(
  profile: AggregatedProfile,
  cardStats: CardStats,
  rarity: Rarity,
): string {
  const topGamesStr = profile.topGames
    .map((g, i) => {
      const parts = [`${i + 1}. ${g.name} — ${g.playtimeHours}h`];
      if (g.vsAverage) parts.push(`(${g.vsAverage}x avg)`);
      if (g.isFree) parts.push("[F2P]");
      if (g.achievementRate !== undefined) parts.push(`achv:${g.achievementRate}%`);
      if (g.pricePerHour !== undefined) parts.push(`$${g.pricePerHour}/h`);
      parts.push(`[${g.tags.join(", ")}]`);
      parts.push(`(${g.genres.join(", ")})`);
      return parts.join(" ");
    })
    .join("\n");

  const genresStr = profile.genreDistribution
    .map((g) => `${g.genre}: ${g.percentage}%`)
    .join(", ");

  const tagsStr = profile.tagDistribution
    .slice(0, 15)
    .map((t) => `${t.tag}: ${t.percentage}%`)
    .join(", ");

  // Achievements section
  const achvStr = profile.achievements.topGames.length > 0
    ? profile.achievements.topGames
        .map((g) => `${g.name}: ${g.completionRate}%${g.rarest ? ` (rarest: ${g.rarest.name} ${g.rarest.percent}%)` : ""}`)
        .join("\n")
    : "No achievement data";

  return `Player: ${profile.player.name} (Steam Level ${profile.player.steamLevel})
Account age: ${profile.timeline.accountAge} years
Friends: ${profile.social.friendsCount}

STATS:
- Total games: ${profile.stats.totalGames}
- Total playtime: ${profile.stats.totalPlaytimeHours} hours
- Average per played game: ${profile.stats.avgPlaytimeHours} hours
- Unplayed: ${profile.stats.unplayedCount} games (${profile.stats.unplayedPercentage}%)

TOP GAMES BY PLAYTIME:
${topGamesStr}

GENRE DISTRIBUTION: ${genresStr}
TAG DISTRIBUTION: ${tagsStr}

ECONOMICS:
- Library value: $${profile.economics.totalLibraryValue}
- Wasted (unplayed): $${profile.economics.wastedValue}
- Free games: ${profile.economics.freePercentage}%

ACHIEVEMENTS:
${achvStr}

PLATFORMS: Windows ${profile.platforms.windowsPercentage}% / Linux ${profile.platforms.linuxPercentage}% / Deck ${profile.platforms.deckPercentage}%

TIMELINE:
- Account age: ${profile.timeline.accountAge} years
- Current monthly hours: ${profile.timeline.currentMonthlyHours}
- Trend: ${profile.timeline.trend}
- Last activity: ${profile.timeline.lastActivityDate || "unknown"}

SOCIAL:
- Friends: ${profile.social.friendsCount}
- Friends per year: ${profile.social.friendsAddedPerYear}

PATTERNS:
- Genre concentration (top-1): ${profile.patterns.genreConcentration}%
- Binge style: ${profile.patterns.bingeStyle}
- Indie games: ${profile.patterns.indiePercentage}%

BADGES: ${profile.badges.totalCount} badges, ${profile.badges.totalXP} XP

METRICS:
- Concentration (top-3 games % of total): ${profile.concentrationRatio}%
- Multiplayer: ${profile.multiplayerRatio}% / Singleplayer: ${profile.singleplayerRatio}%
- Recent activity (2 weeks): ${profile.recentActivity.gamesPlayed2Weeks} games, ${profile.recentActivity.hoursPlayed2Weeks}h
${profile.recentActivity.recentGameNames.length > 0 ? `- Recently played: ${profile.recentActivity.recentGameNames.join(", ")}` : ""}

PERCENTILES:
- Hours: ${profile.ranks.hoursPercentile}th
- Library size: ${profile.ranks.librarySizePercentile}th
- Concentration: ${profile.ranks.concentrationPercentile}th
- Veteran: ${profile.ranks.veteranPercentile}th

CARD DATA (use these EXACT values in your response):
- rarity: "${rarity}"
- stats.dedication: ${cardStats.dedication}
- stats.mastery: ${cardStats.mastery}
- stats.exploration: ${cardStats.exploration}
- stats.hoarding: ${cardStats.hoarding}
- stats.social: ${cardStats.social}
- stats.veteran: ${cardStats.veteran}`;
}
