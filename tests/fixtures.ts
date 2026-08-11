import type {
  SteamPlayer,
  EnrichedGame,
  OwnedGame,
  SteamFriend,
  BadgesResponse,
  AchievementGameData,
} from "@/lib/steam/types";
import type { CardPortrait, Roast } from "@/lib/llm/types";

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

/**
 * Карточка, набитая узнаваемыми строками: каждая встречается ровно один раз и
 * ни на что не похожа. Поиск этих строк в том, что уходит наружу, — главная
 * проверка платной части (и в JSON страницы, и в дереве картинки), поэтому
 * фикстура общая: два теста обязаны искать одни и те же слова.
 *
 * `suffix` собирает вторую карточку той же формы, но с другими словами: на ней
 * проверяется, что пустышка не зависит от содержимого.
 */
export function portraitFixture(suffix = ""): CardPortrait {
  const roast = (severity: Roast["severity"], n: number): Roast => ({
    icon: `${n}⃣`,
    title: `ЗАГОЛОВОКРОАСТА${n}${suffix}`,
    text: `ТЕКСТРОАСТА${n}${suffix} про то, как человек просрал жизнь в очереди матчмейкинга`,
    stat: `ЦИФРАРОАСТА${n}${suffix}`,
    source: `ИСТОЧНИКРОАСТА${n}${suffix}`,
    severity,
  });

  return {
    primaryArchetype: {
      name: `ГЛАВНЫЙАРХЕТИП${suffix}`,
      description: `ОПИСАНИЕГЛАВНОГО${suffix}`,
      color: "#ff00ff",
    },
    secondaryArchetype: {
      name: `ВТОРОЙАРХЕТИП${suffix}`,
      description: `ОПИСАНИЕВТОРОГО${suffix}`,
      color: "#00ff00",
    },
    shadowArchetype: {
      name: `ТЕНЕВОЙАРХЕТИП${suffix}`,
      description: `ОПИСАНИЕТЕНЕВОГО${suffix}`,
      color: "#0000ff",
    },
    title: `ТИТУЛКАРТОЧКИ${suffix}`,
    emoji: "🎮",
    rarity: "legendary",
    element: "shadow",
    creature: `СУЩЕСТВО${suffix}`,
    stats: {
      dedication: 91,
      mastery: 42,
      exploration: 17,
      hoarding: 88,
      social: 3,
      veteran: 64,
    },
    // Самый суровый роаст нарочно не первый и не последний: порядок в массиве
    // не должен подменять порядок по severity.
    roasts: [
      roast("rare", 1),
      roast("epic", 2),
      roast("critical", 3),
      roast("legendary", 4),
      roast("rare", 5),
    ],
    spirit_game: `ИГРАДУШИ${suffix}`,
    spirit_animal: {
      name: `ЖИВОТНОЕДУШИ${suffix}`,
      description: `ОПИСАНИЕЖИВОТНОГО${suffix}`,
      art_description: `АРТЖИВОТНОГО${suffix}`,
    },
    lore: `ЛЕГЕНДАИГРОКА${suffix}`,
    quote: `ЦИТАТАИГРОКА${suffix}`,
    art_mood: `НАСТРОЕНИЕАРТА${suffix}`,
    art_scene: `СЦЕНААРТА${suffix}`,
    psycho_profile: {
      big_five: {
        openness: 70,
        conscientiousness: 30,
        extraversion: 20,
        agreeableness: 55,
        neuroticism: 80,
      },
      big_five_labels: {
        openness: `МЕТКАОТКРЫТОСТИ${suffix}`,
        conscientiousness: `МЕТКАДОБРОСОВЕСТНОСТИ${suffix}`,
        extraversion: `МЕТКАЭКСТРАВЕРСИИ${suffix}`,
        agreeableness: `МЕТКАДОБРОЖЕЛАТЕЛЬНОСТИ${suffix}`,
        neuroticism: `МЕТКАНЕВРОТИЗМА${suffix}`,
      },
      motivations: {
        achievement: 60,
        immersion: 75,
        social: 10,
        mastery: 44,
        escapism: 90,
        curiosity: 33,
      },
      traits: [
        { name: `ЧЕРТАОДИН${suffix}`, score: 80, description: `ОПИСАНИЕЧЕРТЫОДИН${suffix}`, icon: "🧠" },
        { name: `ЧЕРТАДВА${suffix}`, score: 60, description: `ОПИСАНИЕЧЕРТЫДВА${suffix}`, icon: "🔥" },
        { name: `ЧЕРТАТРИ${suffix}`, score: 40, description: `ОПИСАНИЕЧЕРТЫТРИ${suffix}`, icon: "🧊" },
        { name: `ЧЕРТАЧЕТЫРЕ${suffix}`, score: 20, description: `ОПИСАНИЕЧЕРТЫЧЕТЫРЕ${suffix}`, icon: "🌊" },
      ],
      decision_style: "impulsive",
      decision_style_description: `ОПИСАНИЕСТИЛЯРЕШЕНИЙ${suffix}`,
      social_type: "lone_wolf",
      social_type_description: `ОПИСАНИЕСОЦИАЛЬНОГОТИПА${suffix}`,
      psych_summary: `СВОДКАПСИХОПРОФИЛЯ${suffix}`,
      fictional_character: {
        name: `ПЕРСОНАЖ${suffix}`,
        from: `ОТКУДАПЕРСОНАЖ${suffix}`,
        reason: `ПОЧЕМУПЕРСОНАЖ${suffix}`,
      },
    },
  };
}

/** Всё, чего быть не должно там, куда пускают без оплаты. */
export function lockedStrings(portrait: CardPortrait): string[] {
  const psycho = portrait.psycho_profile;
  return [
    portrait.secondaryArchetype.name,
    portrait.secondaryArchetype.description,
    portrait.shadowArchetype.name,
    portrait.shadowArchetype.description,
    portrait.spirit_animal.name,
    portrait.spirit_animal.description,
    portrait.spirit_animal.art_description ?? "",
    portrait.lore,
    portrait.quote,
    portrait.art_mood,
    portrait.art_scene,
    // Все роасты, кроме самого сурового.
    ...portrait.roasts.filter((r) => r.severity !== "critical").flatMap((r) => [r.title, r.text, r.stat, r.source]),
    ...(psycho
      ? [
          ...Object.values(psycho.big_five_labels),
          ...psycho.traits.flatMap((t) => [t.name, t.description]),
          psycho.decision_style_description,
          psycho.social_type_description,
          psycho.psych_summary,
          psycho.fictional_character.name,
          psycho.fictional_character.from,
          psycho.fictional_character.reason,
        ]
      : []),
  ].filter((s) => s.length > 0);
}

export const noBadges: BadgesResponse = { badges: [], player_xp: 0, player_level: 0 };
export const noAchievements: AchievementGameData[] = [];
export const noRecent: OwnedGame[] = [];

export { YEAR };
