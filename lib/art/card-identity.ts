import type { AggregatedProfile } from "../aggregation/types";
import type { CardStats } from "../aggregation/aggregate";

/**
 * Класс существа, а не конкретный зверь.
 *
 * Конкретику придумывает модель — но внутри класса, который выбрал код. Без
 * этого ограничения она уходит в свой самый вероятный образ: из пятнадцати
 * выданных духов восемь оказались грызунами и норными, три из них — хомяк в
 * колесе, а два медоеда подряд повторяли друг друга дословно.
 */
export type CreatureClass =
  | "birds" | "deepSea" | "insects" | "reptiles" | "hoofed" | "bigCats"
  | "primates" | "livestock" | "cephalopods" | "crustaceans"
  | "prehistoric" | "mythic" | "mustelids" | "rodents";

/**
 * Примеры внутри класса перечисляются, но порядок крутится по человеку.
 *
 * Первый пример модель берёт заметно чаще остальных: подсказка для насекомых
 * начиналась с «dung beetle», и навозный жук вышел трижды из трёх. Штамп просто
 * переехал этажом ниже — с класса на конкретного зверя.
 */
export const CREATURE_CLASSES: Record<CreatureClass, { label: string; examples: string[] }> = {
  birds: { label: "a bird", examples: ["pelican", "crow", "ostrich", "penguin", "vulture", "heron", "owl"] },
  deepSea: { label: "a deep-sea creature", examples: ["blobfish", "sperm whale", "moray eel", "anglerfish", "oarfish", "sea cucumber"] },
  insects: { label: "an insect or arachnid", examples: ["mantis", "tarantula", "moth", "leafcutter ant", "cicada", "dung beetle", "water strider"] },
  reptiles: { label: "a reptile or amphibian", examples: ["iguana", "gecko", "crocodile", "axolotl", "toad", "chameleon"] },
  hoofed: { label: "a hoofed animal", examples: ["goat", "moose", "donkey", "camel", "bull", "tapir"] },
  bigCats: { label: "a large predator", examples: ["lynx", "hyena", "snow leopard", "tiger", "wolf", "caracal"] },
  primates: { label: "a primate", examples: ["orangutan", "baboon", "lemur", "gorilla", "macaque", "tarsier"] },
  livestock: { label: "farm livestock", examples: ["pig", "sheep", "rooster", "cow", "turkey", "goose"] },
  cephalopods: { label: "a cephalopod", examples: ["octopus", "squid", "cuttlefish", "nautilus", "bobtail squid"] },
  crustaceans: { label: "a crustacean", examples: ["lobster", "mantis shrimp", "barnacle", "hermit crab", "coconut crab", "krill"] },
  prehistoric: { label: "a prehistoric beast", examples: ["mammoth", "trilobite", "sabertooth", "ankylosaur", "dunkleosteus", "giant sloth"] },
  mythic: { label: "a mythical creature", examples: ["griffin", "kraken", "chimera", "golem", "dragon", "basilisk"] },
  mustelids: { label: "a mustelid or bear", examples: ["otter", "wolverine", "badger", "brown bear", "marten", "honey badger"] },
  rodents: { label: "a rodent or burrower", examples: ["capybara", "porcupine", "marmot", "beaver", "mole", "chinchilla"] },
};

export type Element =
  | "fire" | "ice" | "shadow" | "nature" | "arcane"
  | "storm" | "void" | "iron" | "blood" | "crystal";

/**
 * У каждой черты свой пул классов; вместе они покрывают все четырнадцать.
 *
 * Пул нужен, чтобы связь «человек → зверь» осталась осмысленной, а выбор
 * внутри пула по хешу — чтобы двое с одинаковой выделяющейся чертой не
 * получили одинаковую карточку.
 */
const TRAIT_CLASSES: Record<keyof CardStats, CreatureClass[]> = {
  dedication: ["hoofed", "livestock", "rodents"],
  mastery: ["bigCats", "birds", "mythic"],
  exploration: ["cephalopods", "deepSea", "prehistoric"],
  hoarding: ["crustaceans", "insects", "mustelids"],
  social: ["primates", "livestock", "birds"],
  veteran: ["reptiles", "prehistoric", "mythic"],
};

/**
 * Средние по чертам среди прошедших разбор (замер 2026-08-12, n=29).
 *
 * Сравнивать надо именно с ними: абсолютная величина не отличает никого.
 * Упорство доминировало у 26 человек из 29 при среднем 86 из 100 — кто дошёл
 * до сайта, тот и так задрот, и класс существа у всех получался бы один.
 */
const TRAIT_BASELINE: Record<keyof CardStats, number> = {
  dedication: 86.4,
  mastery: 66.9,
  exploration: 56.0,
  hoarding: 33.8,
  social: 47.3,
  veteran: 65.7,
};

/** Свет и палитра сцены — отдельная ось, иначе все карточки одинаково тёмные. */
export type Palette =
  | "dawn" | "noon" | "storm" | "neonNight"
  | "snow" | "underwater" | "desertHeat" | "autumnDusk";

export const PALETTE_HINTS: Record<Palette, string> = {
  dawn: "cold pink-and-gold dawn light, long soft shadows, clear air",
  noon: "bright clear midday sun, high contrast, saturated colors",
  storm: "thunderstorm light, heavy grey clouds, lightning rim-light",
  neonNight: "neon night, magenta and cyan glow, wet reflective surfaces",
  snow: "whiteout snowfall, pale blue light, frost haze",
  underwater: "underwater light shafts, deep teal water, floating particles",
  desertHeat: "desert noon haze, ochre and burnt orange, heat shimmer",
  autumnDusk: "autumn dusk, amber and rust tones, low warm sun",
};

const PALETTES = Object.keys(PALETTE_HINTS) as Palette[];

export interface CardIdentity {
  creatureClass: CreatureClass;
  element: Element;
  palette: Palette;
}

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/**
 * Черта, по которой человек сильнее всего непохож на остальных.
 *
 * Отклонение относительное, а не разница в очках: барахольщик с 60 при типичных
 * 34 выделяется сильнее, чем упорный с 95 при типичных 86, хотя в очках второй
 * дальше от нуля. Берётся модуль — провал по черте говорит о человеке столько
 * же, сколько всплеск.
 */
export function mostDistinctiveTrait(stats: CardStats): keyof CardStats {
  let best: keyof CardStats = "dedication";
  let bestDeviation = -1;
  for (const key of Object.keys(TRAIT_BASELINE) as (keyof CardStats)[]) {
    const deviation = Math.abs((stats[key] - TRAIT_BASELINE[key]) / TRAIT_BASELINE[key]);
    if (deviation > bestDeviation) {
      bestDeviation = deviation;
      best = key;
    }
  }
  return best;
}

/**
 * Типичная доля темы среди прошедших разбор (замер 2026-08-12 по четырём
 * профилям — пересмотреть, когда наберётся выборка).
 *
 * Сравнение именно с ней, а не выбор самой частой темы: шутеры и RPG есть у
 * каждого, поэтому огонь и природа выигрывали почти всегда и из десяти стихий
 * встречались три.
 */
const ELEMENT_THEMES: { element: Element; pattern: RegExp; baseline: number }[] = [
  { element: "fire", pattern: /shooter|fps|action/i, baseline: 40 },
  { element: "ice", pattern: /strategy|tactical|tower defense|4x/i, baseline: 21 },
  { element: "shadow", pattern: /horror|stealth|noir|dark/i, baseline: 0 },
  { element: "nature", pattern: /rpg|survival|open world|adventure/i, baseline: 26 },
  { element: "arcane", pattern: /puzzle|roguelike|platformer/i, baseline: 0 },
  { element: "storm", pattern: /racing|sports|fighting/i, baseline: 2 },
  { element: "void", pattern: /space|sci-?fi|cyberpunk/i, baseline: 1 },
  { element: "iron", pattern: /simulation|management|building|automation/i, baseline: 4 },
  { element: "blood", pattern: /souls-?like|difficult|hardcore|gore/i, baseline: 1 },
  { element: "crystal", pattern: /relaxing|casual|visual novel|anime|cute/i, baseline: 1 },
];

/** Ниже этого превышения тема не считается выделяющейся. */
const MIN_EXCESS = 3;

function selectElement(profile: AggregatedProfile): Element {
  const shares: [string, number][] = [
    ...(profile.genreDistribution ?? []).map((g) => [g.genre, g.percentage] as [string, number]),
    ...(profile.tagDistribution ?? []).slice(0, 15).map((t) => [t.tag, t.percentage] as [string, number]),
  ];

  let best: Element = "arcane";
  let bestExcess = MIN_EXCESS;
  for (const theme of ELEMENT_THEMES) {
    let share = 0;
    for (const [name, percentage] of shares) if (theme.pattern.test(name)) share += percentage;
    const excess = share - theme.baseline;
    if (excess > bestExcess) {
      bestExcess = excess;
      best = theme.element;
    }
  }
  return best;
}

/**
 * Подсказка модели: класс целиком, но с индивидуальным порядком примеров.
 * Плюс прямой запрет брать самое очевидное — одного перемешивания мало.
 */
export function creatureClassHint(creatureClass: CreatureClass, steamId64: string): string {
  const { label, examples } = CREATURE_CLASSES[creatureClass];
  const offset = hashCode(`${steamId64}:creature`) % examples.length;
  const rotated = [...examples.slice(offset), ...examples.slice(0, offset)];
  return `${label} — for example ${rotated.join(", ")}`;
}

export function selectCardIdentity(
  profile: AggregatedProfile,
  cardStats: CardStats,
  steamId64: string,
): CardIdentity {
  const trait = mostDistinctiveTrait(cardStats);
  const pool = TRAIT_CLASSES[trait];
  const creatureClass = pool[hashCode(steamId64) % pool.length];
  const element = selectElement(profile);
  // Отдельный хеш, иначе палитра намертво срослась бы с классом существа:
  // у всех «ракообразных» был бы один и тот же свет.
  const palette = PALETTES[hashCode(`${steamId64}:palette`) % PALETTES.length];

  console.log(`[card-identity] черта=${trait} класс=${creatureClass} стихия=${element} свет=${palette}`);

  return { creatureClass, element, palette };
}
