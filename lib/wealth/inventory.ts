import { getMarketPrices } from "@/lib/wealth/market-prices";

/**
 * Что считаем. `priced: false` — игра, которой нет в прайс-листе рынка:
 * предметы считаются штуками, а деньги по ним берутся отдельно (карточки).
 */
export const INVENTORY_APPS = [
  { appId: 730, contextId: 2, priced: true },  // CS2
  { appId: 570, contextId: 2, priced: true },  // Dota 2
  { appId: 440, contextId: 2, priced: true },  // TF2
  { appId: 753, contextId: 6, priced: false }, // карточки, эмоции, фоны
] as const;

export type InventoryStatus = "ok" | "private" | "unavailable";

export interface InventoryItem {
  name: string;
  qty: number;
  priceEur?: number;
  marketable: boolean;
}

export interface AppInventory {
  appId: number;
  status: InventoryStatus;
  items: InventoryItem[];
  totalEur: number;
  itemCount: number;
}

interface SteamAsset {
  classid: string;
  instanceid: string;
  amount?: string;
}

interface SteamDescription {
  classid: string;
  instanceid: string;
  market_hash_name: string;
  marketable: number;
}

interface SteamInventory {
  assets?: SteamAsset[];
  descriptions?: SteamDescription[];
}

const empty = (appId: number, status: InventoryStatus): AppInventory => ({
  appId,
  status,
  items: [],
  totalEur: 0,
  itemCount: 0,
});

/**
 * Инвентарь одной игры.
 *
 * Steam отдаёт отдельно описания (уникальные предметы) и активы (каждая копия),
 * связь — по паре `classid`+`instanceid`. Считать по описаниям нельзя: пять
 * одинаковых ящиков превратились бы в один.
 *
 * Приватность инвентаря — отдельная настройка от приватности профиля, поэтому
 * 403 здесь обычное дело даже у человека с открытым профилем.
 */
export async function fetchAppInventory(
  steamId64: string,
  appId: number,
  contextId: number,
): Promise<AppInventory> {
  let raw: SteamInventory | null;
  try {
    const res = await fetch(
      `https://steamcommunity.com/inventory/${steamId64}/${appId}/${contextId}?l=english&count=2000`,
      { signal: AbortSignal.timeout(4000) },
    );
    if (res.status === 403) return empty(appId, "private");
    if (!res.ok) return empty(appId, "unavailable");
    raw = (await res.json()) as SteamInventory | null;
  } catch {
    return empty(appId, "unavailable");
  }

  // Пустое тело — не отказ: так Steam отвечает, когда игры у человека просто нет.
  if (!raw?.assets || !raw.descriptions) return empty(appId, "ok");

  const prices = (await getMarketPrices(appId)) ?? {};
  const byKey = new Map(raw.descriptions.map((d) => [`${d.classid}_${d.instanceid}`, d]));
  const rows = new Map<string, InventoryItem>();
  let itemCount = 0;

  for (const asset of raw.assets) {
    const description = byKey.get(`${asset.classid}_${asset.instanceid}`);
    if (!description) continue;
    const qty = Number(asset.amount ?? 1) || 1;
    itemCount += qty;

    const name = description.market_hash_name;
    const marketable = description.marketable === 1;
    const row = rows.get(name) ?? {
      name,
      qty: 0,
      marketable,
      priceEur: marketable ? prices[name] : undefined,
    };
    row.qty += qty;
    rows.set(name, row);
  }

  const items = [...rows.values()];
  const totalEur = items.reduce((sum, item) => sum + (item.priceEur ?? 0) * item.qty, 0);

  return { appId, status: "ok", items, totalEur, itemCount };
}
