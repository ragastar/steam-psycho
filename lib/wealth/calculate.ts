import type { AggregatedProfile } from "@/lib/aggregation/types";
import { INVENTORY_APPS, fetchInventories } from "@/lib/wealth/inventory";
import { getRates } from "@/lib/wealth/fx";
import type { Wealth, WealthInventoryStatus, WealthItem } from "@/lib/wealth/types";

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
  const round = (n: number) => Math.round(n * 100) / 100;

  const rates = await getRates();
  const eurRub = rates?.eurRub ?? 0;

  // Разбор старой формы (без метки валюты) считался прежней смесью источников
  // в долларах — той самой, ради замены которой база и менялась. Пересчитать
  // такую сумму по курсу нельзя: на боевом это дало «стоимость аккаунта
  // 2 099 036 ₽» вместо десятков тысяч. Пока разбор не пересчитан, библиотеки
  // в кошельке нет, а расчёт помечается неполным — значит хранится час и
  // повторится, когда разбор обновится.
  const libraryKnown = profile.economics.currency === "RUB";
  const libraryRub = profile.economics.totalLibraryValue;
  const unplayedRub = profile.economics.wastedValue;

  const inventories = await fetchInventories(steamId64);

  let inventoryRub = 0;
  let itemCount = 0;
  let cardsEstimated = 0;
  let unpricedItems = 0;
  const items: WealthItem[] = [];
  const notable: string[] = [];
  // Отвечают ли приложения деньгами и сколько из них отказали. Считать «худший
  // ответ побеждает» нельзя: у человека без TF2 один ответ «такой игры нет»
  // прятал за прочерком инвентарь CS2, Dota и карточек, который в это же время
  // уже был посчитан и показан в итоговой строке.
  let answered = 0;
  let refused = 0;
  let anyPrivate = false;

  for (const inv of inventories) {
    // Приложение ищем по номеру, а не по месту в списке: порядок ответов —
    // внутреннее дело обхода, а цена ошибки здесь в том, что деньги за скины
    // посчитались бы по правилам карточек.
    const app = INVENTORY_APPS.find((a) => a.appId === inv.appId);
    if (!app) continue;
    itemCount += inv.itemCount;
    // Игры у человека нет — за этим ответом не стоит ни денег, ни отказа.
    if (inv.status === "missing") continue;
    if (inv.status !== "ok") {
      refused++;
      if (inv.status === "private") anyPrivate = true;
      continue;
    }
    answered++;
    if (app.priced) {
      inventoryRub += inv.totalEur * eurRub;
      for (const item of inv.items) {
        if (item.priceEur !== undefined) {
          const unitRub = item.priceEur * eurRub;
          items.push({ name: item.name, qty: item.qty, unitRub: round(unitRub), totalRub: round(unitRub * item.qty) });
        } else if (item.marketable) {
          // Выставляемый предмет, которого рынок не оценил (обычное дело у CS2/Dota):
          // денег за него нет, но пропадать с витрины молча он не должен.
          unpricedItems += item.qty;
        } else if (notable.length < MAX_NOTABLE) {
          notable.push(item.name);
        }
      }
    } else {
      cardsEstimated = inv.itemCount;
      inventoryRub += inv.itemCount * CARD_AVERAGE_RUB;
    }
  }

  // Топ — по стоимости всей стопки, а не по цене штуки: двадцать копий по рублю
  // дороже одного ножа за пятнадцать, хоть штучно и дешевле.
  const top = items.sort((a, b) => b.totalRub - a.totalRub).slice(0, TOP_ITEMS);

  // Ни одно приложение не ответило данными. Пустым инвентарь при этом не
  // объявляем даже когда все ответы — «такой игры нет»: контекст карточек (753)
  // есть у любого аккаунта, и его молчание означает что угодно, кроме нуля.
  const status: WealthInventoryStatus =
    answered === 0
      ? anyPrivate
        ? "private"
        : "unavailable"
      : refused > 0
        ? "partial"
        : "ok";

  const totalGames = profile.stats.totalGames || 1;
  const totalHours = profile.stats.totalPlaytimeHours || 1;

  return {
    currency: "RUB",
    total: round((libraryKnown ? libraryRub : 0) + inventoryRub),
    library: libraryKnown
      ? {
          total: round(libraryRub),
          avgPrice: round(libraryRub / totalGames),
          perHour: round(libraryRub / totalHours),
          estimated: (profile.economics.estimatedGames ?? 0) > 0,
          unknownGames: profile.economics.unknownGames ?? 0,
        }
      : null,
    unplayed: libraryKnown ? { value: round(unplayedRub) } : null,
    inventory: {
      status,
      total: round(inventoryRub),
      itemCount,
      top,
      notable,
      cardsEstimated,
      unpricedItems,
    },
    complete: libraryKnown && status === "ok" && eurRub > 0,
  };
}
