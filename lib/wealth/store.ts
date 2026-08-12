import { getCache, setCache } from "@/lib/cache/redis";
import { CACHE_TTL, wealthKey } from "@/lib/cache/keys";
import { paywallMode } from "@/lib/access/entitlement";
import { steamIdHasEntitlement } from "@/lib/billing/store";
import { calculateWealth } from "@/lib/wealth/calculate";
import type { AggregatedProfile } from "@/lib/aggregation/types";
import type { Wealth } from "@/lib/wealth/types";

/**
 * Кошелёк из кеша, а если его там нет — счёт и запись.
 *
 * Неполный расчёт имеет предопределённый срок (час), и право ни на что не влияет.
 * Проверяем это сначала, чтобы не открывать SQLite зря.
 *
 * Режим спрашивается ПЕРЕД базой заказов: при `PAYWALL_MODE=off` заказов не
 * существует, а обращение к store открыло бы SQLite и прогнало миграцию таблиц
 * оплаты на каждый показ страницы.
 */
export async function getWealth(profile: AggregatedProfile, steamId64: string): Promise<Wealth> {
  const key = wealthKey(steamId64);
  const cached = await getCache<Wealth>(key);
  if (cached) return cached;

  const wealth = await calculateWealth(profile, steamId64);

  // Неполный расчёт (инвентарь закрыт, рынок молчит или курс не пришёл) имеет
  // предопределённый срок час, и право ни на что не влияет. Проверяем это сначала,
  // чтобы не открывать SQLite зря — когда касса включена, это целевой сценарий.
  const ttl = !wealth.complete
    ? CACHE_TTL.wealthPartial
    : paywallMode() !== "off" && steamIdHasEntitlement(steamId64)
      ? CACHE_TTL.purchased
      : CACHE_TTL.aggregatedProfile;

  await setCache(key, wealth, ttl);
  return wealth;
}
