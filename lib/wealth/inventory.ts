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

/**
 * `missing` — у человека нет этой игры, и инвентаря для неё не существует.
 * Steam отвечает на такой запрос `401` с телом `null`, и это НЕ отказ: живая
 * проверка 2026-08-12 на открытом аккаунте показала 200 с предметами по CS2 и
 * карточкам одновременно с 401 по TF2 и Portal 2, которых у человека нет.
 * Пустой существующий контекст отвечает иначе — 200 и `total_inventory_count: 0`.
 *
 * `throttled` — ограничение по частоте (429). Единственное состояние, которое
 * имеет смысл переспросить: Steam отпускает за минуту-две.
 */
export type InventoryStatus = "ok" | "missing" | "private" | "throttled" | "unavailable";

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
    if (res.status === 401) return empty(appId, "missing");
    if (res.status === 429) return empty(appId, "throttled");
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
    // Группируем по паре (имя, выставляемость): один и тот же item name может иметь
    // разные экземпляры с разной выставляемостью, нужно разделить их на разные строки.
    const rowKey = `${name}__${marketable}`;
    const row = rows.get(rowKey) ?? {
      name,
      qty: 0,
      marketable,
      priceEur: marketable ? prices[name] : undefined,
    };
    row.qty += qty;
    rows.set(rowKey, row);
  }

  const items = [...rows.values()];
  const totalEur = items.reduce((sum, item) => sum + (item.priceEur ?? 0) * item.qty, 0);

  return { appId, status: "ok", items, totalEur, itemCount };
}

/**
 * Пауза между обращениями к Steam и после отказа по частоте.
 *
 * Замер 2026-08-12: примерно после десятка обращений к `steamcommunity.com/inventory`
 * с одного адреса Steam начинает отвечать 429 на всё подряд и отпускает через
 * полторы-две минуты. Один расчёт кошелька — четыре обращения, поэтому залпом
 * их слать нельзя: так два-три посетителя подряд оставляют без инвентаря и
 * себя, и всех следующих.
 */
const GAP_MS = 250;
const RETRY_MS = 1500;

/**
 * Потолок на весь обход. Очередь вместо залпа стоит времени: если Steam лёг и
 * каждый запрос упирается в свой четырёхсекундный потолок, обход с переспросом
 * занял бы больше двадцати секунд — и всё это на уже оплаченной странице,
 * которая рисуется на сервере. Дальше бюджета инвентарь не спрашиваем вовсе.
 */
const SWEEP_BUDGET_MS = 12_000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Все инвентари одного человека — по очереди, с одним переспросом на весь обход.
 *
 * Переспрос ровно один: если лимит держится, он держится для всех четырёх
 * запросов, и четыре паузы подряд задержали бы оплаченную страницу впустую.
 */
export async function fetchInventories(
  steamId64: string,
  { pause = wait, now = Date.now }: {
    pause?: (ms: number) => Promise<unknown>;
    now?: () => number;
  } = {},
): Promise<AppInventory[]> {
  const deadline = now() + SWEEP_BUDGET_MS;
  const out: AppInventory[] = [];
  let retries = 1;

  for (const app of INVENTORY_APPS) {
    if (now() >= deadline) {
      out.push(empty(app.appId, "unavailable"));
      continue;
    }
    if (out.length > 0) await pause(GAP_MS);
    let inv = await fetchAppInventory(steamId64, app.appId, app.contextId);
    if (inv.status === "throttled" && retries > 0 && now() < deadline) {
      retries--;
      await pause(RETRY_MS);
      inv = await fetchAppInventory(steamId64, app.appId, app.contextId);
    }
    out.push(inv);
  }

  return out;
}
