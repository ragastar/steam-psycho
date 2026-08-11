import { brotliDecompressSync } from "node:zlib";
import { cached } from "@/lib/cache/redis";

const SKINPORT_URL = "https://api.skinport.com/v1/items";

export const MARKET_TTL = 24 * 3600;

interface SkinportItem {
  market_hash_name: string;
  suggested_price: number | null;
  median_price: number | null;
  min_price: number | null;
}

/**
 * Тело может прийти и разжатым, и сжатым brotli: заголовок обязателен (без него
 * рынок отвечает 406), а разожмёт ли его среда сама — зависит от версии Node.
 * Поэтому сначала пробуем читать как есть, потом распаковываем.
 */
function parseMaybeBrotli(buf: Buffer): SkinportItem[] {
  try {
    return JSON.parse(buf.toString("utf8")) as SkinportItem[];
  } catch {
    return JSON.parse(brotliDecompressSync(buf).toString("utf8")) as SkinportItem[];
  }
}

/**
 * Карта «имя предмета → цена в евро» для одной игры.
 *
 * Берётся оценка предмета, а не самый дешёвый лот. Минимальный лот — это цена
 * одного объявления: если оно единственное и выставлено вздорно, инвентарь
 * раздувается в разы (живой пример — «Sealed Genesis Terminal»: лот 19.92 при
 * настоящей цене 0.11).
 */
export async function getMarketPrices(appId: number): Promise<Record<string, number> | null> {
  return cached<Record<string, number> | null>(`market:v1:${appId}`, MARKET_TTL, async () => {
    try {
      const res = await fetch(`${SKINPORT_URL}?app_id=${appId}&currency=EUR&tradable=0`, {
        headers: { "Accept-Encoding": "br" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;
      const items = parseMaybeBrotli(Buffer.from(await res.arrayBuffer()));
      const prices: Record<string, number> = {};
      for (const item of items) {
        const price = item.suggested_price ?? item.median_price ?? item.min_price;
        if (price != null) prices[item.market_hash_name] = price;
      }
      return prices;
    } catch {
      return null;
    }
  });
}
