# Разброс карточек — план работ

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Убрать однообразие карточек: разные звери вместо грызунов, разные рамки вместо сплошной легендарки, разный свет вместо тёмной комнаты.

**Architecture:** Все оси выбирает код детерминированно от Steam ID и профиля, модель придумывает конкретику внутри оси. Всюду сравнивается отклонение от типичного, а не абсолютная величина: черта, по которой человек выделяется; жанр, по которому он выделяется; место в выборке вместо порога.

**Tech Stack:** TypeScript, Next 16, vitest, better-sqlite3.

Спека: `docs/superpowers/specs/2026-08-12-card-diversity-design.md`.

**Отличие от спеки:** колонка `steam_level` не добавляется. Сила профиля считается из часов, размера библиотеки и возраста аккаунта — все три уже лежат в таблице `analyses`, поэтому перцентиль считается по истории без миграции.

---

## Task 1: Замер базовых величин

Перед кодом нужно измерить то, с чем будем сравнивать. Числа берутся из живой базы, а не выдумываются.

**Files:**
- Create: `/tmp/measure-baseline.js` (временный, в репозиторий не идёт)

**Step 1: Средние по чертам и распределение силы профиля**

```bash
cd /opt/steam-psycho && docker compose exec -T app node -e '
const Database = require("better-sqlite3");
const db = new Database("/data/db/analytics.db", {readonly:true});
const rows = db.prepare(`SELECT stat_dedication d, stat_mastery m, stat_exploration e,
  stat_hoarding h, stat_social s, stat_veteran v, total_playtime_hours hours,
  library_size games, account_age_years age FROM analyses WHERE stat_dedication IS NOT NULL`).all();
const avg = (f) => (rows.reduce((a,r)=>a+f(r),0)/rows.length).toFixed(1);
console.log("n =", rows.length);
console.log("dedication", avg(r=>r.d), "mastery", avg(r=>r.m), "exploration", avg(r=>r.e));
console.log("hoarding", avg(r=>r.h), "social", avg(r=>r.s), "veteran", avg(r=>r.v));
const score = (r) => 0.5*Math.min((r.hours||0)/5000,1) + 0.3*Math.min((r.games||0)/1000,1) + 0.2*Math.min((r.age||0)/15,1);
const scores = rows.map(score).sort((a,b)=>a-b);
const q = (p) => scores[Math.floor(scores.length*p)].toFixed(3);
console.log("сила профиля: p20", q(0.2), "p50", q(0.5), "p80", q(0.8), "p95", q(0.95));
'
```

Записать вывод — он станет константами в задачах 2 и 6.

**Step 2: Типичные доли жанров и тегов по кешированным профилям**

```bash
cd /opt/steam-psycho && docker compose exec -T app node -e '
const Database = require("better-sqlite3");
const db = new Database("/data/db/analytics.db", {readonly:true});
const rows = db.prepare("SELECT value FROM gate_tokens WHERE key LIKE @a").all({a:"profile:v3:%"});
const acc = {};
for (const r of rows) {
  const p = JSON.parse(r.value);
  for (const g of p.genreDistribution || []) acc["G:"+g.genre] = (acc["G:"+g.genre]||0) + g.percentage/rows.length;
  for (const t of (p.tagDistribution||[]).slice(0,15)) acc["T:"+t.tag] = (acc["T:"+t.tag]||0) + t.percentage/rows.length;
}
console.log("профилей:", rows.length);
for (const [k,v] of Object.entries(acc).sort((a,b)=>b[1]-a[1]).slice(0,40)) console.log(v.toFixed(1), k);
'
```

Записать вывод — он станет таблицей типичных долей в задаче 3.

**Step 3: Commit не нужен** — это замер, кода не появилось.

---

## Task 2: Классы существ и палитра

**Files:**
- Modify: `lib/art/card-identity.ts` (переписывается целиком)
- Test: `tests/card-identity.test.ts` (создать)

**Step 1: Написать падающий тест**

```ts
import { describe, it, expect } from "vitest";
import { selectCardIdentity, CREATURE_CLASS_HINTS } from "@/lib/art/card-identity";
import type { AggregatedProfile } from "@/lib/aggregation/types";
import type { CardStats } from "@/lib/aggregation/aggregate";

/** Профиль ровно средний по всем чертам, кроме заданной. */
function profileWith(overrides: Partial<CardStats> = {}): [AggregatedProfile, CardStats] {
  const stats: CardStats = {
    dedication: 86, mastery: 67, exploration: 56,
    hoarding: 34, social: 47, veteran: 66, ...overrides,
  };
  const profile = {
    genreDistribution: [{ genre: "Action", percentage: 40 }],
    tagDistribution: [{ tag: "FPS", percentage: 30 }],
  } as unknown as AggregatedProfile;
  return [profile, stats];
}

describe("выбор класса существа", () => {
  it("класс берётся по самой выделяющейся черте, а не по самой высокой", () => {
    // Упорство у всех 86 — оно не отличает никого. Барахольщик с 80 при
    // типичных 34 выделяется куда сильнее, и класс должен быть его.
    const [profile, stats] = profileWith({ hoarding: 80 });
    const id = selectCardIdentity(profile, stats, "76561198000000001");
    expect(["crustaceans", "insects", "mustelids"]).toContain(id.creatureClass);
  });

  it("двое с одинаковой выделяющейся чертой получают разные классы", () => {
    const [profile, stats] = profileWith({ hoarding: 80 });
    const a = selectCardIdentity(profile, stats, "76561198000000001");
    const b = selectCardIdentity(profile, stats, "76561198000000002");
    const c = selectCardIdentity(profile, stats, "76561198000000003");
    expect(new Set([a.creatureClass, b.creatureClass, c.creatureClass]).size).toBeGreaterThan(1);
  });

  it("у каждого класса есть подсказка для модели", () => {
    for (const key of Object.keys(CREATURE_CLASS_HINTS)) {
      expect(CREATURE_CLASS_HINTS[key as keyof typeof CREATURE_CLASS_HINTS].length).toBeGreaterThan(10);
    }
    expect(Object.keys(CREATURE_CLASS_HINTS)).toHaveLength(14);
  });

  it("палитра тоже расходится по людям", () => {
    const [profile, stats] = profileWith();
    const palettes = new Set(
      ["1", "2", "3", "4", "5", "6"].map((n) => selectCardIdentity(profile, stats, "7656119800000000" + n).palette),
    );
    expect(palettes.size).toBeGreaterThan(2);
  });

  it("выбор воспроизводим: тот же Steam ID — тот же результат", () => {
    const [profile, stats] = profileWith({ social: 90 });
    const a = selectCardIdentity(profile, stats, "76561198000000009");
    const b = selectCardIdentity(profile, stats, "76561198000000009");
    expect(a).toEqual(b);
  });
});
```

**Step 2: Убедиться, что тест падает**

Run: `npx vitest run tests/card-identity.test.ts`
Expected: FAIL — `creatureClass` не существует, `CREATURE_CLASS_HINTS` не экспортируется.

**Step 3: Переписать `lib/art/card-identity.ts`**

Удалить целиком: `Creature`, `STAT_CREATURES`. Они в картинку не попадают — художник получает описание от модели.

```ts
import type { AggregatedProfile } from "../aggregation/types";
import type { CardStats } from "../aggregation/aggregate";

/**
 * Класс существа, а не конкретный зверь. Конкретику придумывает модель — но
 * внутри класса, который выбрал код. Без этого ограничения модель уходит в
 * свой самый вероятный образ: из пятнадцати выданных духов восемь были
 * грызунами и норными, три из них — хомяк в колесе.
 */
export type CreatureClass =
  | "birds" | "deepSea" | "insects" | "reptiles" | "hoofed" | "bigCats"
  | "primates" | "livestock" | "cephalopods" | "crustaceans"
  | "prehistoric" | "mythic" | "mustelids" | "rodents";

export const CREATURE_CLASS_HINTS: Record<CreatureClass, string> = {
  birds: "a bird — owl, pelican, crow, ostrich, penguin, vulture, heron",
  deepSea: "a deep-sea creature — anglerfish, blobfish, sperm whale, moray eel",
  insects: "an insect or arachnid — dung beetle, mantis, tarantula, moth, ant",
  reptiles: "a reptile or amphibian — iguana, gecko, crocodile, axolotl, toad",
  hoofed: "a hoofed animal — goat, moose, donkey, camel, bull, tapir",
  bigCats: "a large predator — tiger, lynx, wolf, hyena, snow leopard",
  primates: "a primate — orangutan, baboon, lemur, gorilla, macaque",
  livestock: "farm livestock — pig, sheep, rooster, cow, turkey, goose",
  cephalopods: "a cephalopod — octopus, squid, cuttlefish, nautilus",
  crustaceans: "a crustacean — crab, lobster, mantis shrimp, barnacle",
  prehistoric: "a prehistoric beast — dinosaur, mammoth, trilobite, sabertooth",
  mythic: "a mythical creature — dragon, griffin, kraken, chimera, golem",
  mustelids: "a mustelid or bear — badger, otter, wolverine, raccoon, brown bear",
  rodents: "a rodent or burrower — capybara, mole, beaver, porcupine, marmot",
};

/**
 * У каждой черты свой пул классов; вместе они покрывают все четырнадцать.
 * Пул нужен, чтобы связь «человек → зверь» осталась осмысленной, а хеш внутри
 * пула — чтобы двое с одинаковой выделяющейся чертой не получили одно и то же.
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
 * Средние по чертам среди тех, кто уже прошёл разбор (замер 2026-08-12, n=29).
 *
 * Нужны, потому что абсолютная величина не отличает никого: упорство
 * доминировало у 26 человек из 29 при среднем 86 из 100 — кто дошёл до сайта,
 * тот и так задрот. Отличает отклонение от этой середины.
 *
 * ЗАМЕНИТЬ значениями из задачи 1, если замер дал другое.
 */
const TRAIT_BASELINE: Record<keyof CardStats, number> = {
  dedication: 86.4, mastery: 66.9, exploration: 56.0,
  hoarding: 33.8, social: 47.3, veteran: 65.7,
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

/** Черта, по которой человек сильнее всего непохож на остальных. */
export function mostDistinctiveTrait(stats: CardStats): keyof CardStats {
  let best: keyof CardStats = "dedication";
  let bestDeviation = -1;
  for (const key of Object.keys(TRAIT_BASELINE) as (keyof CardStats)[]) {
    const baseline = TRAIT_BASELINE[key];
    // Относительное отклонение, а не разница: провал по редкой черте говорит
    // о человеке столько же, сколько всплеск, поэтому берётся модуль.
    const deviation = Math.abs((stats[key] - baseline) / baseline);
    if (deviation > bestDeviation) {
      bestDeviation = deviation;
      best = key;
    }
  }
  return best;
}
```

Дальше в том же файле — `selectCardIdentity`, собирающий три оси:

```ts
export function selectCardIdentity(
  profile: AggregatedProfile,
  cardStats: CardStats,
  steamId64: string,
): CardIdentity {
  const trait = mostDistinctiveTrait(cardStats);
  const pool = TRAIT_CLASSES[trait];
  const creatureClass = pool[hashCode(steamId64) % pool.length];
  const element = selectElement(profile); // задача 3
  const palette = PALETTES[hashCode(steamId64 + ":palette") % PALETTES.length];

  console.log(`[card-identity] черта=${trait} класс=${creatureClass} стихия=${element} свет=${palette}`);
  return { creatureClass, element, palette };
}
```

**Step 4: Прогнать тест**

Run: `npx vitest run tests/card-identity.test.ts`
Expected: PASS (кроме тестов стихии — она в задаче 3; временно `selectElement` может возвращать `"arcane"`).

**Step 5: Commit**

```bash
git add lib/art/card-identity.ts tests/card-identity.test.ts
git commit -m "feat: класс существа и палитра выбираются по отклонению от типичного"
```

---

## Task 3: Стихия по отклонению

**Files:**
- Modify: `lib/art/card-identity.ts`
- Test: `tests/card-identity.test.ts`

**Step 1: Написать падающий тест**

```ts
describe("выбор стихии", () => {
  it("частый жанр не побеждает сам по себе", () => {
    // Шутеры есть у всех: 40% при типичных 38 не значат ничего.
    // Хоррор 12% при типичных 2 — значит.
    const profile = {
      genreDistribution: [{ genre: "Action", percentage: 40 }, { genre: "Horror", percentage: 12 }],
      tagDistribution: [],
    } as unknown as AggregatedProfile;
    const stats = { dedication: 86, mastery: 67, exploration: 56, hoarding: 34, social: 47, veteran: 66 };
    expect(selectCardIdentity(profile, stats, "1").element).toBe("shadow");
  });

  it("профиль без выделяющихся жанров получает стихию по умолчанию, а не огонь", () => {
    const profile = {
      genreDistribution: [{ genre: "Action", percentage: 38 }],
      tagDistribution: [],
    } as unknown as AggregatedProfile;
    const stats = { dedication: 86, mastery: 67, exploration: 56, hoarding: 34, social: 47, veteran: 66 };
    expect(selectCardIdentity(profile, stats, "1").element).toBe("arcane");
  });
});
```

**Step 2: Убедиться, что падает.** Run: `npx vitest run tests/card-identity.test.ts`

**Step 3: Реализовать**

```ts
/**
 * Типичная доля темы среди прошедших разбор (замер по кешированным профилям,
 * 2026-08-12). ЗАМЕНИТЬ значениями из задачи 1.
 *
 * Сравнивать надо именно с ней: побеждал самый частый жанр, а шутеры и RPG
 * есть у каждого — поэтому из десяти стихий встречались три (огонь 14,
 * природа 11, железо 2).
 */
const ELEMENT_THEMES: { element: Element; pattern: RegExp; baseline: number }[] = [
  { element: "fire", pattern: /shooter|fps|action/i, baseline: 38 },
  { element: "ice", pattern: /strategy|tactical|tower defense|4x/i, baseline: 8 },
  { element: "shadow", pattern: /horror|stealth|noir|dark/i, baseline: 2 },
  { element: "nature", pattern: /rpg|survival|open world|adventure/i, baseline: 22 },
  { element: "arcane", pattern: /puzzle|roguelike|platformer/i, baseline: 6 },
  { element: "storm", pattern: /racing|sports|fighting/i, baseline: 4 },
  { element: "void", pattern: /space|sci-?fi|cyberpunk/i, baseline: 5 },
  { element: "iron", pattern: /simulation|management|building|automation/i, baseline: 6 },
  { element: "blood", pattern: /souls-?like|difficult|hardcore|gore/i, baseline: 3 },
  { element: "crystal", pattern: /relaxing|casual|visual novel|anime|cute/i, baseline: 4 },
];

/** Насколько человек выделяется по этой теме. Ниже — стихия не выбирается. */
const MIN_EXCESS = 3;

function selectElement(profile: AggregatedProfile): Element {
  const shares = [
    ...(profile.genreDistribution ?? []).map((g) => [g.genre, g.percentage] as const),
    ...(profile.tagDistribution ?? []).slice(0, 15).map((t) => [t.tag, t.percentage] as const),
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
```

**Step 4: Прогнать тест.** Expected: PASS.

**Step 5: Commit**

```bash
git add lib/art/card-identity.ts tests/card-identity.test.ts
git commit -m "feat: стихия по отклонению от типичной доли жанра"
```

---

## Task 4: Редкость по месту в выборке

**Files:**
- Modify: `lib/aggregation/aggregate.ts` (функция `calculateRarity`)
- Modify: `lib/analytics/queries.ts` (добавить `getRaritySample`)
- Modify: `app/api/analyze/route.ts:192`
- Test: `tests/rarity.test.ts` (создать)

**Step 1: Написать падающий тест**

```ts
import { describe, it, expect } from "vitest";
import { calculateRarity, profileStrength } from "@/lib/aggregation/aggregate";

const profile = (hours: number, games: number, age: number) =>
  ({ stats: { totalPlaytimeHours: hours, totalGames: games }, timeline: { accountAge: age } }) as never;

describe("редкость", () => {
  it("без выборки пользуется порогами из кода, и легендарка достаётся не всем", () => {
    // Сегодняшний живой случай: 5913 часов, 157 игр — таких у нас большинство,
    // и легендарными были 27 карточек из 27.
    expect(calculateRarity(profile(5913, 157, 12), null)).not.toBe("legendary");
  });

  it("с выборкой редкость — это место в ней", () => {
    const sample = Array.from({ length: 100 }, (_, i) => i / 100);
    const strong = profileStrength(profile(20000, 2000, 20));
    expect(calculateRarity(profile(20000, 2000, 20), sample)).toBe("legendary");
    expect(strong).toBeGreaterThan(0.9);
    expect(calculateRarity(profile(10, 5, 0.2), sample)).toBe("common");
  });
});
```

**Step 2: Убедиться, что падает.**

**Step 3: Реализовать**

```ts
/**
 * Сила профиля от 0 до 1. Три слагаемых выбраны так, чтобы их можно было
 * посчитать и по историческим строкам таблицы разборов — иначе не с чем
 * сравнивать. Уровень Steam сюда не входит именно поэтому: его в истории нет.
 */
export function profileStrength(profile: AggregatedProfile): number {
  const hours = Math.min((profile.stats.totalPlaytimeHours || 0) / 5000, 1);
  const games = Math.min((profile.stats.totalGames || 0) / 1000, 1);
  const age = Math.min((profile.timeline?.accountAge || 0) / 15, 1);
  return 0.5 * hours + 0.3 * games + 0.2 * age;
}

/**
 * Пороги из кода на то время, пока своей выборки мало. Сняты с 29 разборов
 * (замер 2026-08-12) — ЗАМЕНИТЬ значениями из задачи 1.
 */
const STRENGTH_THRESHOLDS: [number, Rarity][] = [
  [0.78, "legendary"], [0.62, "epic"], [0.42, "rare"], [0.22, "uncommon"],
];

export function calculateRarity(profile: AggregatedProfile, sample: number[] | null): Rarity {
  const strength = profileStrength(profile);

  // Место в выборке — единственный честный способ сделать редкость редкой.
  // Прежняя формула давала легендарку любому с 2500 часами, то есть всем.
  if (sample && sample.length >= MIN_SAMPLE_FOR_REAL_PERCENTILES) {
    const rank = percentileRank(sample, strength);
    if (rank >= 95) return "legendary";
    if (rank >= 80) return "epic";
    if (rank >= 50) return "rare";
    if (rank >= 20) return "uncommon";
    return "common";
  }

  for (const [threshold, rarity] of STRENGTH_THRESHOLDS) if (strength >= threshold) return rarity;
  return "common";
}
```

В `lib/analytics/queries.ts`:

```ts
/** Сила профиля каждого, кто уже прошёл разбор. null — выборки ещё мало. */
export function getRaritySample(): number[] | null {
  const rows = query<{ h: number | null; l: number | null; a: number | null }>(
    `SELECT total_playtime_hours AS h, library_size AS l, account_age_years AS a
     FROM analyses WHERE cached = 0 AND total_playtime_hours IS NOT NULL`,
  );
  if (rows.length < MIN_SAMPLE_FOR_REAL_PERCENTILES) return null;
  return rows.map((r) =>
    0.5 * Math.min((r.h || 0) / 5000, 1) + 0.3 * Math.min((r.l || 0) / 1000, 1) + 0.2 * Math.min((r.a || 0) / 15, 1),
  );
}
```

В `app/api/analyze/route.ts` заменить `const rarity = calculateRarity(profile);` на `const rarity = calculateRarity(profile, getRaritySample());`.

**Step 4: Прогнать `npm run verify`.** Ожидается, что упадут старые тесты редкости, если они есть, — поправить их под новую подпись.

**Step 5: Commit**

```bash
git add lib/aggregation/aggregate.ts lib/analytics/queries.ts app/api/analyze/route.ts tests/rarity.test.ts
git commit -m "feat: редкость — место в выборке, а не сумма часов"
```

---

## Task 5: Класс существа и запреты в промпте текста

**Files:**
- Modify: `lib/llm/prompt.ts` (оба системных промпта и `buildUserPrompt`)
- Modify: `lib/llm/client.ts:151` (подпись `generatePortrait`)
- Modify: `app/api/generate/route.ts` (читать личность карточки ДО генерации)
- Test: `tests/prompt-diversity.test.ts` (создать)

**Step 1: Написать падающий тест**

```ts
import { describe, it, expect } from "vitest";
import { buildUserPrompt } from "@/lib/llm/prompt";

it("промпт требует существо из заданного класса и запрещает штампы", () => {
  const prompt = buildUserPrompt(profileFixture, statsFixture, "rare", {
    creatureClass: "cephalopods", element: "void", palette: "storm",
  });
  expect(prompt).toContain("cephalopod");
  expect(prompt.toLowerCase()).toContain("hamster");   // в списке запрещённых
  expect(prompt.toLowerCase()).toContain("skinner");   // крыса в клетке Скиннера
});
```

**Step 2: Убедиться, что падает.**

**Step 3: Реализовать**

В `buildUserPrompt` добавить четвёртый аргумент `identity: CardIdentity` и в конец возвращаемой строки:

```ts
SPIRIT ANIMAL CONSTRAINTS (mandatory):
- The spirit animal MUST be ${CREATURE_CLASS_HINTS[identity.creatureClass]}
- BANNED clichés, never use these: hamster in a wheel, rat in a Skinner box, sloth, trash panda / raccoon with garbage, generic "gamer mole in a basement"
- Inside the class, be as absurd and specific as you like — that is the point

ART SCENE CONSTRAINTS (mandatory):
- The scene is the WORLD of their games (a Dota lane, an Elite starmap, a Deep Rock cave), never a room
- NO humans, no gamer at a desk, no monitors, no energy drink cans, no dark bedroom
- Lighting for this card: ${PALETTE_HINTS[identity.palette]}
```

В обоих системных промптах строку про `spirit_animal` заменить на: `"name": "существо ИЗ ЗАДАННОГО КЛАССА (см. SPIRIT ANIMAL CONSTRAINTS) — чем абсурднее и точнее, тем лучше"`, а строку `art_scene` — на `"Сцена в мире его игр, без людей и без комнаты (см. ART SCENE CONSTRAINTS)"`.

В `generatePortrait` добавить параметр `identity: CardIdentity` перед необязательным `provider` и прокинуть в `buildUserPrompt`.

В `app/api/generate/route.ts` поднять чтение личности карточки выше генерации:

```ts
const cardIdentity = await getCache<CardIdentity>(artIdentityKey(steamId64))
  || selectCardIdentity(profile, cardStats, steamId64);
const generated = await generatePortrait(profile, cardStats, rarity, locale, cardIdentity);
```

**Step 4: `npm run verify`.**

**Step 5: Commit**

```bash
git add lib/llm/prompt.ts lib/llm/client.ts app/api/generate/route.ts tests/prompt-diversity.test.ts
git commit -m "feat: класс существа и запрет штампов уезжают в промпт"
```

---

## Task 6: Свет вместо темноты в промпте картинки

**Files:**
- Modify: `lib/art/prompt-builder.ts`
- Modify: `app/api/art/generate/route.ts:57-62`
- Test: `tests/art-prompt.test.ts` (создать)

**Step 1: Написать падающий тест**

```ts
it("промпт художника берёт свет из палитры и не требует темноты", () => {
  const prompt = buildImagePrompt(portraitFixture, "void", "snow");
  expect(prompt).toContain("whiteout snowfall");
  expect(prompt.toLowerCase()).not.toContain("dark moody background");
});

it("людей на картинке быть не должно", () => {
  expect(buildImagePrompt(portraitFixture, "void", "noon").toLowerCase()).toContain("no humans");
});
```

**Step 2: Убедиться, что падает.**

**Step 3: Реализовать**

Удалить мёртвый `CREATURE_DESCRIPTIONS` и ветку легаси-совпадения в `getCreatureDescription` — художник получает описание от модели, эти восемнадцать существ не участвуют.

Подпись: `buildImagePrompt(portrait, element, palette)`. Строку `Dark moody background behind the card.` заменить на `Lighting and palette: ${PALETTE_HINTS[palette]}.`, а в конец добавить `No humans, no people, no gaming desk setup.`

В маршруте картинки читать палитру из личности карточки (`identity?.palette || "neonNight"`).

**Step 4: `npm run verify`.**

**Step 5: Commit**

```bash
git add lib/art/prompt-builder.ts app/api/art/generate/route.ts tests/art-prompt.test.ts
git commit -m "feat: свет карточки задаётся палитрой, люди с картинки убраны"
```

---

## Task 7: Версии ключей и чистка картинок

**Files:**
- Modify: `lib/cache/keys.ts`
- Modify: все места, где сегодня пишется `art:identity:${steamId64}` строкой (`app/api/analyze/route.ts`, `app/api/generate/route.ts`, `app/api/art/generate/route.ts`)

**Step 1: Добавить функцию ключа личности карточки**

```ts
/**
 * v2: у личности карточки изменилась форма (класс существа и палитра вместо
 * конкретного зверя). Раньше ключ был без версии вовсе — старую запись нечем
 * было бы отличить от новой.
 */
export function artIdentityKey(steamId64: string): string {
  return `art:identity:v2:${steamId64}`;
}
```

Заменить три строковых ключа на вызов функции. Проверить, что `art:identity:` остаётся в `PERSISTENT_PREFIXES`.

**Step 2: Поднять версию карточки**

`portrait:v6` → `portrait:v7`: меняется текст (зверь, редкость), значит старые карточки читать нельзя.

**Step 3: `npm run verify`, затем commit**

```bash
git add lib/cache/keys.ts app/api/analyze/route.ts app/api/generate/route.ts app/api/art/generate/route.ts
git commit -m "fix: версии ключей карточки и личности после смены формы"
```

**Step 4: Выкатить и удалить картинки**

```bash
cd /opt/steam-psycho && docker compose up -d --build
```

Дождаться `curl -sf localhost:3001/api/health`, затем удалить старые картинки — иначе человек получит новый текст со старой картинкой:

```bash
docker compose exec -T app sh -lc 'rm -f /data/art/*.png && ls /data/art'
```

---

## Task 8: Прогон и сводка владельцу

**Step 1: Пересчитать всех, у кого есть разбор**

Для каждого из восьми Steam ID из кеша: `POST /api/analyze`, затем `POST /api/generate`, с паузой 20 секунд между людьми (лимит магазина Steam).

**Step 2: Собрать сводку**

```bash
cd /opt/steam-psycho && docker compose exec -T app node -e '
const Database = require("better-sqlite3");
const db = new Database("/data/db/analytics.db", {readonly:true});
for (const r of db.prepare("SELECT key, value FROM gate_tokens WHERE key LIKE @a").all({a:"portrait:v7:%"})) {
  const p = JSON.parse(r.value);
  console.log(r.key.split(":")[2], "|", p.rarity, "|", p.spirit_animal && p.spirit_animal.name);
}
const el = db.prepare("SELECT element, COUNT(*) n FROM analyses WHERE element IS NOT NULL GROUP BY element").all();
console.log("стихии:", JSON.stringify(el));
'
```

**Step 3: Показать владельцу таблицу** — звери, редкости, стихии. Критерий успеха: грызуны не больше чем у одного из восьми, редкости минимум трёх видов, стихий минимум трёх видов.

**Step 4: Если критерий не выполнен** — не подкручивать промпт наугад, а вернуться к @superpowers:systematic-debugging и найти, какая ось не сработала.

---

## Что делать с покупателями

У троих (`76561198052849092`, `76561198055956381`, `76561198140642959`) разбор и карточка хранятся десять лет. После смены версии ключа они увидят «данные устарели», если не пересчитать заранее — задача 8 это и делает, их надо прогнать первыми.
