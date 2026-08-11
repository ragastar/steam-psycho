import type { Archetype, CardPortrait, CardStats, Rarity, Roast, Severity } from "../llm/types";

/**
 * Урезание карточки до бесплатной части.
 *
 * Брат `redact.ts`: тот режет профиль, этот — карточку. Раньше платное
 * закрывалось размытием поверх настоящего текста, а это косметика — «посмотреть
 * код страницы», режим чтения или отключённый CSS открывали весь разбор даром.
 * Теперь платного текста в браузере нет вообще, а размывается пустышка.
 *
 * Список бесплатного задан перечислением, а не вычитанием платного: при
 * добавлении нового поля в `CardPortrait` оно по умолчанию окажется закрытым.
 * Обратная форма («скопировать всё и удалить лишнее») однажды пропустила бы
 * ровно то поле, о котором забыли, — а ошибка обязана закрывать, а не открывать.
 */

/**
 * Место закрытого роаста: рамка есть, слов нет.
 *
 * `icon` и `severity` настоящие — по ним видно, что внутри карточки есть
 * «critical», и это честная витрина покупки.
 *
 * `source` в пустышке нет вовсе — хотя у бесплатного роаста он уезжает наружу
 * вместе с остальным, и это не противоречие. Бесплатен целый роаст, а не
 * огрызок: у него настоящие и текст, и цифра, и источник. Пустышка же прячет
 * свой роаст целиком, а `source` договаривает как раз то, что спрятано:
 * «Cyberpunk 2077 — 3ч из 100ч средних» — это половина шутки. Выдумывать ему
 * замену незачем: в вёрстке он идёт мелкой строкой рядом со `stat`.
 */
export interface LockedRoast {
  icon: string;
  severity: Severity;
  /** Выдумка постоянной длины, не связанная с настоящим заголовком. */
  title: string;
  /** Выдумка постоянной длины, не связанная с настоящим текстом. */
  text: string;
  /** Выдумка на месте цифры. */
  stat: string;
}

export interface FreePortrait {
  primaryArchetype: Archetype;
  title: string;
  emoji: string;
  rarity: Rarity;
  stats: CardStats;
  spirit_game: string;
  /** Ровно один настоящий роаст — самый суровый. Тот, которым делятся. */
  roasts: Roast[];
  /** Пустышки на месте остальных: сколько их, столько и куплено. */
  lockedRoasts: LockedRoast[];
}

/** Порядок суровости: critical > legendary > epic > rare. Меньше — суровее. */
const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  legendary: 1,
  epic: 2,
  rare: 3,
};

/**
 * Кеш карточек живёт сутками и переживает смену схемы, поэтому в старой записи
 * может лежать severity, о которой код не знает. Незнакомое считаем самым
 * мягким: бесплатно открывается один роаст, и лучше отдать заведомо настоящий
 * «critical», чем непонятную запись.
 */
function severityRank(severity: Severity): number {
  return SEVERITY_RANK[severity] ?? Number.MAX_SAFE_INTEGER;
}

/**
 * Слова пустышки выдуманы целиком и одинаковы для любой карточки.
 *
 * Соблазн сделать заглушку из настоящего текста (перемешать буквы, заменить
 * символы, обрезать) выглядит красиво и тащит наружу больше, чем кажется:
 * перемешанное восстанавливается, а длины слов и пунктуация выдают фразу
 * целиком. Независимость от содержимого — не мелочь оформления, а само условие
 * того, что платного текста в браузере нет.
 */
const FILLER_WORDS = [
  // Обычного «lorem» здесь нет намеренно: слово содержит имя закрытого поля
  // `lore`, и проверка «закрытого нет в выдаче» спотыкалась о подстроку.
  // Заглушка не должна случайно называть то, что она прячет.
  "ipsum",
  "dolor",
  "sit",
  "amet",
  "consectetur",
  "adipiscing",
  "elit",
  "sed",
  "eiusmod",
  "tempor",
  "incididunt",
  "labore",
  "magna",
  "aliqua",
];

/**
 * Длины постоянны и подобраны под средний настоящий роаст (заголовок в 3–5
 * слов, текст в пару строк). Считать их по настоящей карточке нельзя: длина —
 * это тоже сведения о закрытом тексте.
 */
const DUMMY_TITLE_LENGTH = 26;
const DUMMY_TEXT_LENGTH = 150;
const DUMMY_STAT_LENGTH = 12;

/**
 * Набирает выдуманную строку примерно заданной длины, начиная с `offset`-го
 * слова, — чтобы соседние пустышки не выглядели копиркой. Результат
 * детерминированный: одна и та же карточка всегда даёт одну и ту же вёрстку, и
 * серверная отрисовка совпадает с браузерной.
 */
function filler(length: number, offset: number): string {
  const words: string[] = [];
  let used = 0;
  for (let i = 0; used < length; i++) {
    const word = FILLER_WORDS[(offset + i) % FILLER_WORDS.length];
    words.push(word);
    used += word.length + 1;
  }
  return words.join(" ");
}

function toLockedRoast(roast: Roast, index: number): LockedRoast {
  return {
    icon: roast.icon,
    severity: roast.severity,
    title: filler(DUMMY_TITLE_LENGTH, index * 3),
    text: filler(DUMMY_TEXT_LENGTH, index * 5 + 1),
    stat: filler(DUMMY_STAT_LENGTH, index * 2 + 7),
  };
}

/**
 * То, что можно отдать в браузер до оплаты.
 *
 * Бесплатно: главный архетип, титул, эмодзи, редкость, свои цифры, игра души и
 * один — самый суровый — роаст. Это то, чем делятся. Всё остальное заменяется
 * пустышками или не уезжает вовсе.
 */
export function toFreePortrait(portrait: CardPortrait): FreePortrait {
  const roasts = portrait.roasts ?? [];

  // Ищем самый суровый вручную, а не сортировкой: при равной суровости должен
  // побеждать первый в карточке (порядок роастов задаёт модель), а сортировка
  // на равных ключах этого не обещает.
  let harshestIndex = -1;
  roasts.forEach((roast, i) => {
    if (harshestIndex === -1 || severityRank(roast.severity) < severityRank(roasts[harshestIndex].severity)) {
      harshestIndex = i;
    }
  });

  return {
    primaryArchetype: portrait.primaryArchetype,
    title: portrait.title,
    emoji: portrait.emoji,
    rarity: portrait.rarity,
    stats: portrait.stats,
    spirit_game: portrait.spirit_game,
    roasts: harshestIndex === -1 ? [] : [roasts[harshestIndex]],
    lockedRoasts: roasts.filter((_, i) => i !== harshestIndex).map(toLockedRoast),
  };
}
