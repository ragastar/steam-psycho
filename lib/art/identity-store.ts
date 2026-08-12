import { getCache, setCache } from "@/lib/cache/redis";
import { CACHE_TTL, artIdentityKey } from "@/lib/cache/keys";
import { selectCardIdentity, type CardIdentity } from "@/lib/art/card-identity";
import type { AggregatedProfile } from "@/lib/aggregation/types";
import type { CardStats } from "@/lib/aggregation/aggregate";

/**
 * Личность карточки из кеша, а если её там нет — выбор и запись.
 *
 * Записывать обязательно, а не считать на лету у каждого, кому понадобилось.
 * Разбор берётся из кеша чаще, чем считается заново (сутки у обычного человека,
 * десять лет у покупателя), и полный путь разбора, который единственный писал
 * эту запись, при этом не выполняется вовсе. Тогда генерация текста считала
 * личность у себя и забывала, а художник не находил ничего и брал значения по
 * умолчанию — одинаковый свет и одинаковую рамку всем подряд.
 */
export async function ensureCardIdentity(
  profile: AggregatedProfile,
  cardStats: CardStats,
  steamId64: string,
): Promise<CardIdentity> {
  const key = artIdentityKey(steamId64);
  const cached = await getCache<CardIdentity>(key);
  if (cached) return cached;

  const identity = selectCardIdentity(profile, cardStats, steamId64);
  await setCache(key, identity, CACHE_TTL.portrait);
  return identity;
}
