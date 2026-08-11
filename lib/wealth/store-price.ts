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
  /**
   * Жанры из того же ответа appdetails, что дал цену (или, если цены не
   * нашлось, из последнего опрошенного региона) — отдельного похода в
   * магазин за жанрами больше нет, они приезжают вместе.
   */
  genres: string[];
}

interface RegionPrice {
  isFree: boolean;
  final?: number; // в копейках/центах, как отдаёт магазин
  genres: string[];
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
        genres?: { description: string }[];
      } }>;
      const app = data[String(appId)];
      if (!app?.success || !app.data) return null;
      const genres = app.data.genres?.map((g) => g.description) ?? [];
      return { isFree: app.data.is_free === true, final: app.data.price_overview?.final, genres };
    } catch {
      return null;
    }
  });
}

/**
 * Сколько игра стоит в рублях сейчас (и заодно — какие у неё жанры).
 *
 * Сначала российский магазин: там настоящая цена со скидками. Игра, которой в
 * РФ нет, добирается американской ценой по курсу — иначе половина библиотеки у
 * человека молча превратилась бы в ноль. Жанры едут в том же ответе: если РФ
 * не дала цены и код всё равно пошёл в US, оттуда же берутся и они —
 * специально второй раз в магазин за жанрами ходить незачем.
 */
export async function getGamePrice(appId: number): Promise<GamePrice> {
  const ru = await fetchRegion(appId, "ru");
  const ruGenres = ru?.genres ?? [];
  if (ru?.isFree) return { isFree: true, source: "none", genres: ruGenres };
  if (ru?.final) return { rub: ru.final / 100, isFree: false, source: "ru", genres: ruGenres };

  const us = await fetchRegion(appId, "us");
  const genres = ruGenres.length > 0 ? ruGenres : (us?.genres ?? []);
  if (us?.isFree) return { isFree: true, source: "none", genres };
  if (us?.final) {
    const rates = await getRates();
    if (rates) {
      return {
        rub: Math.round((us.final / 100) * rates.usdRub * 100) / 100,
        isFree: false,
        source: "us",
        genres,
      };
    }
  }

  return { isFree: false, source: "none", genres };
}
