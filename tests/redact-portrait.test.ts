import { describe, it, expect } from "vitest";
import { toFreePortrait } from "@/lib/access/redact-portrait";
import type { CardPortrait, Roast } from "@/lib/llm/types";

/**
 * Фикстура нарочно набита узнаваемыми строками: каждая закрытая строка
 * встречается в карточке ровно один раз и ни на что не похожа. Поиск этих
 * строк в сериализованной бесплатной карточке — главная проверка задачи.
 *
 * `suffix` позволяет собрать вторую карточку той же формы, но с другими
 * словами: на ней проверяется, что пустышка не зависит от содержимого.
 */
function portraitFixture(suffix = ""): CardPortrait {
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

/** Всё, чего в браузере быть не должно, пока разбор не оплачен. */
function lockedStrings(portrait: CardPortrait): string[] {
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

describe("урезание карточки до оплаты (MON-2)", () => {
  const portrait = portraitFixture();
  const free = toFreePortrait(portrait);
  const serialized = JSON.stringify(free);

  it("оставляет бесплатную часть: вердикт, редкость, цифры, игру души", () => {
    expect(free.primaryArchetype).toEqual(portrait.primaryArchetype);
    expect(free.title).toBe(portrait.title);
    expect(free.emoji).toBe(portrait.emoji);
    expect(free.rarity).toBe(portrait.rarity);
    expect(free.stats).toEqual(portrait.stats);
    expect(free.spirit_game).toBe(portrait.spirit_game);
  });

  it("отдаёт ровно один роаст, и это самый суровый", () => {
    expect(free.roasts).toHaveLength(1);
    expect(free.roasts[0]).toEqual(portrait.roasts[2]);
  });

  it("ГЛАВНОЕ: ни одно закрытое слово не уезжает в браузер", () => {
    for (const secret of lockedStrings(portrait)) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("отдаёт ровно перечисленные поля и ничего сверх", () => {
    // Белый список, а не чёрный: новое поле карточки обязано появиться здесь
    // осознанно, а не просочиться потому, что о нём забыли.
    expect(Object.keys(free).sort()).toEqual([
      "emoji",
      "lockedRoasts",
      "primaryArchetype",
      "rarity",
      "roasts",
      "spirit_game",
      "stats",
      "title",
    ]);
  });

  it("не отдаёт закрытые разделы даже пустыми ключами", () => {
    for (const key of [
      "psycho_profile",
      "lore",
      "quote",
      "spirit_animal",
      "secondaryArchetype",
      "shadowArchetype",
      "art_mood",
      "art_scene",
    ]) {
      expect(serialized).not.toContain(key);
      expect(free).not.toHaveProperty(key);
    }
  });

  it("показывает объём покупки: пустышек столько же, сколько закрытых роастов", () => {
    expect(free.lockedRoasts).toHaveLength(portrait.roasts.length - 1);
  });

  it("у пустышек настоящие icon и severity, но выдуманные слова", () => {
    const hidden = portrait.roasts.filter((_, i) => i !== 2);
    expect(free.lockedRoasts.map((r) => r.severity)).toEqual(hidden.map((r) => r.severity));
    expect(free.lockedRoasts.map((r) => r.icon)).toEqual(hidden.map((r) => r.icon));

    const realTexts = portrait.roasts.flatMap((r) => [r.title, r.text, r.stat]);
    for (const dummy of free.lockedRoasts) {
      expect(realTexts).not.toContain(dummy.text);
      expect(realTexts).not.toContain(dummy.title);
      expect(dummy.text.length).toBeGreaterThan(0);
      expect(dummy.title.length).toBeGreaterThan(0);
    }
  });

  it("пустышка не зависит от содержимого карточки", () => {
    // Если бы заглушка порождалась из настоящего текста (перемешиванием,
    // заменой букв, обрезкой), она тащила бы наружу его форму. Одинаковые
    // пустышки на двух разных карточках доказывают, что она выдумана.
    const other = toFreePortrait(portraitFixture("-ДРУГОЙ"));
    expect(other.lockedRoasts.map((r) => r.text)).toEqual(free.lockedRoasts.map((r) => r.text));
    expect(other.lockedRoasts.map((r) => r.title)).toEqual(free.lockedRoasts.map((r) => r.title));
    expect(other.lockedRoasts.map((r) => r.stat)).toEqual(free.lockedRoasts.map((r) => r.stat));
  });

  it("не роняет страницу на битой карточке без роастов", () => {
    const broken = { ...portraitFixture(), roasts: [] } as unknown as CardPortrait;
    const result = toFreePortrait(broken);
    expect(result.roasts).toHaveLength(0);
    expect(result.lockedRoasts).toHaveLength(0);
  });

  it("при незнакомой severity не считает роаст самым суровым", () => {
    // Кеш живёт сутками и переживает смену схемы: в старой карточке может
    // лежать severity, о которой код не знает. Такой роаст обязан оказаться
    // в конце очереди, а не открыться бесплатно вместо critical.
    const withJunk = portraitFixture();
    const junk = { ...withJunk.roasts[0], severity: "апокалипсис" } as unknown as Roast;
    const result = toFreePortrait({ ...withJunk, roasts: [junk, ...withJunk.roasts.slice(1)] });
    expect(result.roasts[0]?.severity).toBe("critical");
  });
});
