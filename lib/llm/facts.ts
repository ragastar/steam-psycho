import type { CardPortrait, Rarity } from "./types";
import type { CardStats } from "../aggregation/aggregate";

/**
 * Возвращает портрет, в котором все проверяемые числа заменены на посчитанные
 * кодом.
 *
 * Модель просят повторить статы и редкость дословно, но она регулярно их
 * перевирает — и тогда на карточке оказывается цифра, которая противоречит
 * подписи под ней (подпись берётся из настоящего профиля). Ответу модели
 * доверяем только текст, числа — никогда.
 */
export function applyComputedFacts(
  portrait: CardPortrait,
  cardStats: CardStats,
  rarity: Rarity,
): CardPortrait {
  return { ...portrait, stats: { ...cardStats }, rarity };
}
