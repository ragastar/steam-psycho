import { getCache, setCache } from "@/lib/cache/redis";
import { CACHE_TTL, artIdentityKey, cardStatsKey, rarityKey } from "@/lib/cache/keys";
import { calculateCardStats, calculateRarity, type CardStats } from "@/lib/aggregation/aggregate";
import { getRaritySample } from "@/lib/analytics/queries";
import { selectCardIdentity, type CardIdentity } from "@/lib/art/card-identity";
import type { AggregatedProfile } from "@/lib/aggregation/types";
import type { Rarity } from "@/lib/llm/types";

/**
 * Спутники карточки — цифры, редкость, личность — по уже готовому разбору.
 *
 * Все три считаются из разбора начисто, без единого обращения к Steam, и живут
 * под своими ключами с версиями. Отсюда правило: как только версия одного из
 * них меняется, у человека с готовым разбором спутника не станет, а разбор
 * заново не посчитается — он выходит из кеша раньше.
 *
 * Без этой достройки получалась глухая петля: генерация отвечает «данные
 * устарели» и зовёт разобраться заново, разбор отвечает «уже есть» и ничего не
 * делает. Выйти из неё человек не может никак.
 *
 * Проверено на живом: после смены правил редкость осталась старой у всех, у
 * кого разбор взялся из кеша, — шесть легендарок из восьми вместо трёх.
 */
export async function ensureCardCompanions(
  steamId64: string,
  profile: AggregatedProfile,
): Promise<{ cardStats: CardStats; rarity: Rarity; identity: CardIdentity }> {
  let cardStats = await getCache<CardStats>(cardStatsKey(steamId64));
  if (!cardStats) {
    cardStats = calculateCardStats(profile);
    await setCache(cardStatsKey(steamId64), cardStats, CACHE_TTL.aggregatedProfile);
  }

  let rarity = await getCache<Rarity>(rarityKey(steamId64));
  if (!rarity) {
    rarity = calculateRarity(profile, getRaritySample());
    await setCache(rarityKey(steamId64), rarity, CACHE_TTL.aggregatedProfile);
  }

  let identity = await getCache<CardIdentity>(artIdentityKey(steamId64));
  if (!identity) {
    identity = selectCardIdentity(profile, cardStats, steamId64);
    await setCache(artIdentityKey(steamId64), identity, CACHE_TTL.portrait);
  }

  return { cardStats, rarity, identity };
}
