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
 * Режим спрашивается ПЕРЕД базой заказов: при `PAYWALL_MODE=off` заказов не
 * существует, а обращение к store открыло бы SQLite и прогнало миграцию таблиц
 * оплаты на каждый показ страницы.
 */
export async function getWealth(profile: AggregatedProfile, steamId64: string): Promise<Wealth> {
  const key = wealthKey(steamId64);
  const cached = await getCache<Wealth>(key);
  if (cached) return cached;

  const wealth = await calculateWealth(profile, steamId64);

  // Режим спрашивается ДО базы заказов, чтобы не открывать SQLite впустую
  let purchased = false;
  if (paywallMode() !== "off") {
    purchased = steamIdHasEntitlement(steamId64);
  }

  const ttl = !wealth.complete
    ? CACHE_TTL.wealthPartial
    : purchased
      ? CACHE_TTL.purchased
      : CACHE_TTL.aggregatedProfile;

  await setCache(key, wealth, ttl);
  return wealth;
}
