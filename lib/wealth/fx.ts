import { cached } from "@/lib/cache/redis";

/**
 * Дневной курс ЦБ. Отдаёт рубли за единицу валюты.
 *
 * ЦБ публикует обратные котировки (сколько валюты в одном рубле), поэтому
 * здесь деление, а не умножение. Доллар нужен играм без российской цены,
 * евро — инвентарю: прайс-лист рынка приходит в евро.
 */
const CBR_URL = "https://www.cbr-xml-daily.ru/latest.js";

export const FX_TTL = 24 * 3600;

export interface Rates {
  usdRub: number;
  eurRub: number;
}

export async function getRates(): Promise<Rates | null> {
  return cached<Rates | null>("fx:cbr:v1", FX_TTL, async () => {
    try {
      const res = await fetch(CBR_URL, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return null;
      const data = (await res.json()) as { rates?: Record<string, number> };
      const usd = data.rates?.USD;
      const eur = data.rates?.EUR;
      if (!usd || !eur) return null;
      return { usdRub: 1 / usd, eurRub: 1 / eur };
    } catch {
      // Курс — не то, ради чего стоит ронять платную страницу.
      return null;
    }
  });
}
