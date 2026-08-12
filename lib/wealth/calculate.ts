import type { AggregatedProfile } from "@/lib/aggregation/types";
import { INVENTORY_APPS, fetchAppInventory } from "@/lib/wealth/inventory";
import { getRates } from "@/lib/wealth/fx";
import type { Wealth, WealthItem } from "@/lib/wealth/types";

/**
 * Средняя цена карточки в рублях.
 *
 * Прайс-лист рынка карточек не знает, а спрашивать Steam поштучно нельзя: 20
 * запросов в минуту, у человека их бывает под две сотни. Замер 2026-08-11 по
 * выборке из восьми имён — 6.15 ₽.
 */
export const CARD_AVERAGE_RUB = 6.15;

const TOP_ITEMS = 5;
const MAX_NOTABLE = 5;

export async function calculateWealth(
  profile: AggregatedProfile,
  steamId64: string,
): Promise<Wealth> {
  const rates = await getRates();
  const eurRub = rates?.eurRub ?? 0;

  // Старые разборы считались в долларах: у покупателей профиль лежит вечно и
  // пересчитан не будет. Метка валюты появилась вместе с рублёвой базой, её
  // отсутствие и означает «доллары».
  const libraryRub =
    profile.economics.currency === "RUB"
      ? profile.economics.totalLibraryValue
      : profile.economics.totalLibraryValue * (rates?.usdRub ?? 0);
  const unplayedRub =
    profile.economics.currency === "RUB"
      ? profile.economics.wastedValue
      : profile.economics.wastedValue * (rates?.usdRub ?? 0);

  const inventories = await Promise.all(
    INVENTORY_APPS.map((app) => fetchAppInventory(steamId64, app.appId, app.contextId)),
  );

  let inventoryRub = 0;
  let itemCount = 0;
  let cardsEstimated = 0;
  const items: WealthItem[] = [];
  const notable: string[] = [];
  let status = inventories[0].status;

  for (let i = 0; i < inventories.length; i++) {
    const inv = inventories[i];
    const app = INVENTORY_APPS[i];
    itemCount += inv.itemCount;
    if (inv.status !== "ok") {
      // Худший исход побеждает: закрытый инвентарь важнее удачного соседа.
      if (status === "ok") status = inv.status;
      continue;
    }
    if (app.priced) {
      inventoryRub += inv.totalEur * eurRub;
      for (const item of inv.items) {
        if (item.priceEur) items.push({ name: item.name, qty: item.qty, rub: item.priceEur * eurRub });
        else if (!item.marketable && notable.length < MAX_NOTABLE) notable.push(item.name);
      }
    } else {
      cardsEstimated = inv.itemCount;
      inventoryRub += inv.itemCount * CARD_AVERAGE_RUB;
    }
  }

  const top = items.sort((a, b) => b.rub * b.qty - a.rub * a.qty).slice(0, TOP_ITEMS);
  const totalGames = profile.stats.totalGames || 1;
  const totalHours = profile.stats.totalPlaytimeHours || 1;
  const round = (n: number) => Math.round(n * 100) / 100;

  return {
    currency: "RUB",
    total: round(libraryRub + inventoryRub),
    library: {
      total: round(libraryRub),
      avgPrice: round(libraryRub / totalGames),
      perHour: round(libraryRub / totalHours),
      estimated: (profile.economics.estimatedGames ?? 0) > 0,
      unknownGames: profile.economics.unknownGames ?? 0,
    },
    unplayed: { value: round(unplayedRub) },
    inventory: {
      status,
      total: round(inventoryRub),
      itemCount,
      top: top.map((item) => ({ ...item, rub: round(item.rub) })),
      notable,
      cardsEstimated,
    },
    complete: status === "ok" && eurRub > 0,
  };
}
