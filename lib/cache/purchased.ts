import { CACHE_TTL, cardStatsKey, portraitKey, profileKey, rarityKey } from "./keys";
import { getCache, setCache } from "./redis";

/**
 * Языки карточки. Список повторяет `i18n/routing.ts`, а не импортируется из
 * него: за `routing` тянется `createNavigation` из next-intl со ссылками на
 * `next/navigation`, то есть на браузерный React. Этот модуль зовут вебхук и
 * генерация — серверные маршруты, — и такой хвост им не нужен.
 */
const LOCALES = ["ru", "en"] as const;

/**
 * Перекладывает всё, что относится к разбору, на очень долгий срок.
 *
 * Зачем это отдельной функцией и зачем зовётся из ДВУХ мест — вебхука и
 * генерации. Порядок событий в жизни такой: разбор → генерация (кладётся на
 * сутки) → бесплатный вердикт → покупка. К моменту покупки карточка УЖЕ лежит с
 * суточным сроком, а генерация больше не случится: /api/generate первым делом
 * видит готовый портрет в кеше и выходит. Продли срок только там — и купленное
 * всё равно пропадёт через сутки вместе с разобранным профилем, а покупатель на
 * третий день получит «данные устарели» за свои деньги.
 *
 * Портрет перекладывается в ОБЕИХ локалях: покупатель мог сгенерировать
 * карточку по-русски, а вернуться по английской ссылке.
 *
 * Чего в кеше нет — молча пропускается: это не ошибка, а обычное состояние
 * (например, английского перевода никто не открывал).
 */
export async function persistPurchased(steamId64: string): Promise<void> {
  const keys = [
    profileKey(steamId64),
    cardStatsKey(steamId64),
    rarityKey(steamId64),
    ...LOCALES.map((locale) => portraitKey(steamId64, locale)),
  ];

  for (const key of keys) {
    try {
      const value = await getCache<unknown>(key);
      if (value === null || value === undefined) continue;
      await setCache(key, value, CACHE_TTL.purchased);
    } catch (err) {
      // Осечка одного ключа не должна прервать остальные и тем более не должна
      // портить ответ вебхуку: право важнее кеша.
      console.error(`[cache] не удалось продлить хранение ${key}:`, err);
    }
  }
}
