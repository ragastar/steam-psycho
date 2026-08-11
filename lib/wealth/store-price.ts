import { cached } from "@/lib/cache/redis";
import { getRates } from "@/lib/wealth/fx";

const STORE_URL = "https://store.steampowered.com/api/appdetails";

export const STORE_PRICE_TTL = 7 * 24 * 3600;

export type PriceSource = "ru" | "us" | "none";

export interface GamePrice {
  /** Цена в рублях. Отсутствует у бесплатных и у тех, о ком магазин молчит. */
  rub?: number;
  isFree: boolean;
  source: PriceSource;
}

interface RegionPrice {
  isFree: boolean;
  final?: number; // в копейках/центах, как отдаёт магазин
}

async function fetchRegion(appId: number, cc: "ru" | "us"): Promise<RegionPrice | null> {
  return cached<RegionPrice | null>(`storeprice:v1:${cc}:${appId}`, STORE_PRICE_TTL, async () => {
    try {
      const res = await fetch(`${STORE_URL}?appids=${appId}&cc=${cc}&l=english`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as Record<string, { success?: boolean; data?: {
        is_free?: boolean;
        price_overview?: { final?: number };
      } }>;
      const app = data[String(appId)];
      if (!app?.success || !app.data) return null;
      return { isFree: app.data.is_free === true, final: app.data.price_overview?.final };
    } catch {
      return null;
    }
  });
}

/**
 * Сколько игра стоит в рублях сейчас.
 *
 * Сначала российский магазин: там настоящая цена со скидками. Игра, которой в
 * РФ нет, добирается американской ценой по курсу — иначе половина библиотеки у
 * человека молча превратилась бы в ноль.
 */
export async function getGamePrice(appId: number): Promise<GamePrice> {
  const ru = await fetchRegion(appId, "ru");
  if (ru?.isFree) return { isFree: true, source: "none" };
  if (ru?.final) return { rub: ru.final / 100, isFree: false, source: "ru" };

  const us = await fetchRegion(appId, "us");
  if (us?.isFree) return { isFree: true, source: "none" };
  if (us?.final) {
    const rates = await getRates();
    if (rates) return { rub: Math.round((us.final / 100) * rates.usdRub * 100) / 100, isFree: false, source: "us" };
  }

  return { isFree: false, source: "none" };
}
