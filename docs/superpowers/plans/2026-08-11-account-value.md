# Кошелёк: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Показать в платной части разбора стоимость аккаунта — библиотека плюс инвентарь Steam — в рублях.

**Architecture:** Новый модуль `lib/wealth/` из четырёх независимых кусков (курс, цена игры, прайс-лист рынка, инвентарь) и сборщика. Кошелёк считается при первом платном показе страницы и живёт отдельной записью кеша `wealth:v1:<steamId64>`, а не полем разобранного профиля: профили покупателей хранятся десять лет, и менять их форму нельзя. Библиотечная часть берётся из уже посчитанного `economics`, который этим же планом переводится на единую рублёвую базу цен.

**Tech Stack:** TypeScript, Next.js 16 (серверные компоненты), vitest, кеш `lib/cache/redis.ts` (память + SQLite для устойчивых префиксов).

**Спека:** `docs/superpowers/specs/2026-08-11-account-value-design.md`

## Global Constraints

- Валюта витрины — рубли. Курс — дневной ЦБ через `https://www.cbr-xml-daily.ru/latest.js`.
- Цены игр — магазин Steam региона `ru` (текущие, со скидками); нет российской цены — американская по курсу.
- Цены предметов — `suggested_price` Skinport, затем `median_price`, и только потом `min_price`.
- Skinport без заголовка `Accept-Encoding: br` отвечает 406; тело приходит сжатым brotli.
- Инвентарь берётся публичной ручкой `steamcommunity.com/inventory/...`, ключ Steam там не работает.
- Никакой поход наружу не роняет страницу: любой отказ — это отсутствие части блока.
- Деньги никогда не попадают в `CardStats` — эти цифры бесплатны.
- Форма `AggregatedProfile` меняется только необязательными полями. Номер версии ключа `profile:v2:` не трогать: под ним лежат вечные записи покупателей.
- Каждая задача заканчивается зелёным `npm run verify` (типы, линтер `--max-warnings 0`, тесты).
- Тесты не ходят в сеть: `vi.stubGlobal("fetch", ...)` и подмена `@/lib/cache/redis`, как в `tests/enrich.test.ts`.
- Сообщения пользователю — в `messages/ru.json` и `messages/en.json`, без вшитых строк в компонентах.

---

### Task 1: Курс валют

**Files:**
- Create: `lib/wealth/fx.ts`
- Test: `tests/wealth-fx.test.ts`

**Interfaces:**
- Consumes: `cached` из `@/lib/cache/redis`.
- Produces: `interface Rates { usdRub: number; eurRub: number }`, `getRates(): Promise<Rates | null>`, `FX_TTL: number`.

- [ ] **Step 1: Написать падающий тест**

```ts
// tests/wealth-fx.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchSpy = vi.fn();
vi.stubGlobal("fetch", fetchSpy);
vi.mock("@/lib/cache/redis", () => ({
  cached: async (_k: string, _t: number, fetcher: () => Promise<unknown>) => fetcher(),
}));

beforeEach(() => fetchSpy.mockReset());

describe("курс валют", () => {
  it("переворачивает котировки ЦБ в рубли за единицу", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ rates: { USD: 0.0121, EUR: 0.0105 } }), { status: 200 }),
    );
    const { getRates } = await import("@/lib/wealth/fx");
    const rates = await getRates();
    expect(rates?.usdRub).toBeCloseTo(82.64, 1);
    expect(rates?.eurRub).toBeCloseTo(95.24, 1);
  });

  it("молчит, а не падает, когда ЦБ недоступен", async () => {
    fetchSpy.mockResolvedValue(new Response("", { status: 500 }));
    const { getRates } = await import("@/lib/wealth/fx");
    expect(await getRates()).toBeNull();
  });

  it("молчит при обрыве связи", async () => {
    fetchSpy.mockRejectedValue(new Error("network"));
    const { getRates } = await import("@/lib/wealth/fx");
    expect(await getRates()).toBeNull();
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run tests/wealth-fx.test.ts`
Expected: FAIL — модуль `@/lib/wealth/fx` не найден.

- [ ] **Step 3: Написать модуль**

```ts
// lib/wealth/fx.ts
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
```

- [ ] **Step 4: Убедиться, что тест проходит**

Run: `npx vitest run tests/wealth-fx.test.ts`
Expected: PASS (3 теста)

- [ ] **Step 5: Коммит**

```bash
git add lib/wealth/fx.ts tests/wealth-fx.test.ts
git commit -m "feat: курс ЦБ для кошелька"
```

---

### Task 2: Цена игры в рублях

**Files:**
- Create: `lib/wealth/store-price.ts`
- Test: `tests/wealth-store-price.test.ts`

**Interfaces:**
- Consumes: `getRates` из `@/lib/wealth/fx`, `cached` из `@/lib/cache/redis`.
- Produces: `type PriceSource = "ru" | "us" | "none"`, `interface GamePrice { rub?: number; isFree: boolean; source: PriceSource }`, `getGamePrice(appId: number): Promise<GamePrice>`, `STORE_PRICE_TTL: number`.

- [ ] **Step 1: Написать падающий тест**

```ts
// tests/wealth-store-price.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchSpy = vi.fn();
vi.stubGlobal("fetch", fetchSpy);
vi.mock("@/lib/cache/redis", () => ({
  cached: async (_k: string, _t: number, fetcher: () => Promise<unknown>) => fetcher(),
}));
vi.mock("@/lib/wealth/fx", () => ({
  getRates: async () => ({ usdRub: 80, eurRub: 95 }),
  FX_TTL: 1,
}));

function storeResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

beforeEach(() => fetchSpy.mockReset());

describe("цена игры", () => {
  it("берёт российскую цену как есть", async () => {
    fetchSpy.mockResolvedValueOnce(
      storeResponse({ "570": { success: true, data: { is_free: false, price_overview: { final: 99900 } } } }),
    );
    const { getGamePrice } = await import("@/lib/wealth/store-price");
    expect(await getGamePrice(570)).toEqual({ rub: 999, isFree: false, source: "ru" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("добирает американскую цену по курсу, когда в РФ игры нет", async () => {
    fetchSpy
      .mockResolvedValueOnce(storeResponse({ "10": { success: true, data: { is_free: false } } }))
      .mockResolvedValueOnce(
        storeResponse({ "10": { success: true, data: { is_free: false, price_overview: { final: 1999 } } } }),
      );
    const { getGamePrice } = await import("@/lib/wealth/store-price");
    expect(await getGamePrice(10)).toEqual({ rub: 1599.2, isFree: false, source: "us" });
  });

  it("бесплатную игру не пытается оценивать вторым запросом", async () => {
    fetchSpy.mockResolvedValueOnce(storeResponse({ "440": { success: true, data: { is_free: true } } }));
    const { getGamePrice } = await import("@/lib/wealth/store-price");
    expect(await getGamePrice(440)).toEqual({ isFree: true, source: "none" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("молчащий магазин — это отсутствие цены, а не исключение", async () => {
    fetchSpy.mockResolvedValue(new Response("", { status: 429 }));
    const { getGamePrice } = await import("@/lib/wealth/store-price");
    expect(await getGamePrice(777)).toEqual({ isFree: false, source: "none" });
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run tests/wealth-store-price.test.ts`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Написать модуль**

```ts
// lib/wealth/store-price.ts
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
    if (rates) return { rub: (us.final / 100) * rates.usdRub, isFree: false, source: "us" };
  }

  return { isFree: false, source: "none" };
}
```

- [ ] **Step 4: Убедиться, что тест проходит**

Run: `npx vitest run tests/wealth-store-price.test.ts`
Expected: PASS (4 теста)

- [ ] **Step 5: Коммит**

```bash
git add lib/wealth/store-price.ts tests/wealth-store-price.test.ts
git commit -m "feat: цена игры в рублях с добором по курсу"
```

---

### Task 3: Прайс-лист рынка

**Files:**
- Create: `lib/wealth/market-prices.ts`
- Test: `tests/wealth-market-prices.test.ts`

**Interfaces:**
- Consumes: `cached` из `@/lib/cache/redis`.
- Produces: `getMarketPrices(appId: number): Promise<Record<string, number> | null>` (имя предмета → цена в евро), `MARKET_TTL: number`.

- [ ] **Step 1: Написать падающий тест**

```ts
// tests/wealth-market-prices.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { brotliCompressSync } from "node:zlib";

const fetchSpy = vi.fn();
vi.stubGlobal("fetch", fetchSpy);
vi.mock("@/lib/cache/redis", () => ({
  cached: async (_k: string, _t: number, fetcher: () => Promise<unknown>) => fetcher(),
}));

const ITEMS = [
  // Ровно тот случай, ради которого берётся оценка, а не минимальный лот:
  // один мусорный лот в 180 раз дороже настоящей цены предмета.
  { market_hash_name: "Sealed Genesis Terminal", suggested_price: 0.11, median_price: 19.92, min_price: 19.92 },
  { market_hash_name: "AWP | Exothermic (Factory New)", suggested_price: 15.03, median_price: 11.36, min_price: 9.72 },
  { market_hash_name: "Без оценки", suggested_price: null, median_price: 3.5, min_price: 2 },
  { market_hash_name: "Совсем без цены", suggested_price: null, median_price: null, min_price: null },
];

beforeEach(() => fetchSpy.mockReset());

describe("прайс-лист рынка", () => {
  it("берёт оценку предмета, а не самый дешёвый лот", async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify(ITEMS), { status: 200 }));
    const { getMarketPrices } = await import("@/lib/wealth/market-prices");
    const prices = await getMarketPrices(730);
    expect(prices?.["Sealed Genesis Terminal"]).toBe(0.11);
    expect(prices?.["AWP | Exothermic (Factory New)"]).toBe(15.03);
  });

  it("падает на медиану, когда оценки нет, и пропускает предметы без цен вовсе", async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify(ITEMS), { status: 200 }));
    const { getMarketPrices } = await import("@/lib/wealth/market-prices");
    const prices = await getMarketPrices(730);
    expect(prices?.["Без оценки"]).toBe(3.5);
    expect(prices).not.toHaveProperty("Совсем без цены");
  });

  it("разжимает ответ, сжатый brotli", async () => {
    const packed = brotliCompressSync(Buffer.from(JSON.stringify(ITEMS)));
    fetchSpy.mockResolvedValue(new Response(packed, { status: 200 }));
    const { getMarketPrices } = await import("@/lib/wealth/market-prices");
    const prices = await getMarketPrices(730);
    expect(prices?.["AWP | Exothermic (Factory New)"]).toBe(15.03);
  });

  it("просит brotli заголовком — без него рынок отвечает отказом", async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify(ITEMS), { status: 200 }));
    const { getMarketPrices } = await import("@/lib/wealth/market-prices");
    await getMarketPrices(730);
    const init = fetchSpy.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers["Accept-Encoding"]).toContain("br");
  });

  it("недоступный рынок — это null, а не исключение", async () => {
    fetchSpy.mockResolvedValue(new Response("", { status: 406 }));
    const { getMarketPrices } = await import("@/lib/wealth/market-prices");
    expect(await getMarketPrices(730)).toBeNull();
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run tests/wealth-market-prices.test.ts`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Написать модуль**

```ts
// lib/wealth/market-prices.ts
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
        if (price) prices[item.market_hash_name] = price;
      }
      return prices;
    } catch {
      return null;
    }
  });
}
```

- [ ] **Step 4: Убедиться, что тест проходит**

Run: `npx vitest run tests/wealth-market-prices.test.ts`
Expected: PASS (5 тестов)

- [ ] **Step 5: Коммит**

```bash
git add lib/wealth/market-prices.ts tests/wealth-market-prices.test.ts
git commit -m "feat: прайс-лист рынка по оценке предмета"
```

---

### Task 4: Инвентарь

**Files:**
- Create: `lib/wealth/inventory.ts`
- Test: `tests/wealth-inventory.test.ts`

**Interfaces:**
- Consumes: `getMarketPrices` из `@/lib/wealth/market-prices`.
- Produces:
  - `type InventoryStatus = "ok" | "private" | "unavailable"`
  - `interface InventoryItem { name: string; qty: number; priceEur?: number; marketable: boolean }`
  - `interface AppInventory { appId: number; status: InventoryStatus; items: InventoryItem[]; totalEur: number; itemCount: number }`
  - `fetchAppInventory(steamId64: string, appId: number, contextId: number): Promise<AppInventory>`
  - `INVENTORY_APPS: { appId: number; contextId: number; priced: boolean }[]`

- [ ] **Step 1: Написать падающий тест**

```ts
// tests/wealth-inventory.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchSpy = vi.fn();
vi.stubGlobal("fetch", fetchSpy);
vi.mock("@/lib/wealth/market-prices", () => ({
  getMarketPrices: async () => ({ "Дорогой нож": 100, "Ящик": 1.5 }),
  MARKET_TTL: 1,
}));

/** Пять одинаковых ящиков: в описаниях одна строка, в активах пять. */
const INVENTORY = {
  assets: [
    { classid: "1", instanceid: "0", amount: "1" },
    ...Array.from({ length: 5 }, () => ({ classid: "2", instanceid: "0", amount: "1" })),
    { classid: "3", instanceid: "0", amount: "1" },
  ],
  descriptions: [
    { classid: "1", instanceid: "0", market_hash_name: "Дорогой нож", marketable: 1 },
    { classid: "2", instanceid: "0", market_hash_name: "Ящик", marketable: 1 },
    { classid: "3", instanceid: "0", market_hash_name: "10 Year Veteran Coin", marketable: 0 },
  ],
  total_inventory_count: 7,
};

beforeEach(() => fetchSpy.mockReset());

describe("инвентарь", () => {
  it("считает по экземплярам, а не по строкам списка", async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify(INVENTORY), { status: 200 }));
    const { fetchAppInventory } = await import("@/lib/wealth/inventory");
    const inv = await fetchAppInventory("76561198140642959", 730, 2);

    expect(inv.status).toBe("ok");
    // 100 за нож + 5 × 1.5 за ящики
    expect(inv.totalEur).toBeCloseTo(107.5, 2);
    expect(inv.items.find((i) => i.name === "Ящик")?.qty).toBe(5);
  });

  it("невыставляемые предметы не идут в сумму, но остаются в списке", async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify(INVENTORY), { status: 200 }));
    const { fetchAppInventory } = await import("@/lib/wealth/inventory");
    const inv = await fetchAppInventory("1", 730, 2);
    const coin = inv.items.find((i) => i.name === "10 Year Veteran Coin");
    expect(coin?.marketable).toBe(false);
    expect(coin?.priceEur).toBeUndefined();
  });

  it("закрытый инвентарь — это состояние, а не ошибка", async () => {
    fetchSpy.mockResolvedValue(new Response("", { status: 403 }));
    const { fetchAppInventory } = await import("@/lib/wealth/inventory");
    const inv = await fetchAppInventory("1", 730, 2);
    expect(inv.status).toBe("private");
    expect(inv.items).toEqual([]);
  });

  it("пустой ответ Steam (игры у человека нет) — это пустой инвентарь", async () => {
    fetchSpy.mockResolvedValue(new Response("null", { status: 200 }));
    const { fetchAppInventory } = await import("@/lib/wealth/inventory");
    const inv = await fetchAppInventory("1", 440, 2);
    expect(inv.status).toBe("ok");
    expect(inv.itemCount).toBe(0);
  });

  it("обрыв связи — недоступность, разбор не падает", async () => {
    fetchSpy.mockRejectedValue(new Error("network"));
    const { fetchAppInventory } = await import("@/lib/wealth/inventory");
    expect((await fetchAppInventory("1", 730, 2)).status).toBe("unavailable");
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run tests/wealth-inventory.test.ts`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Написать модуль**

```ts
// lib/wealth/inventory.ts
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
```

- [ ] **Step 4: Убедиться, что тест проходит**

Run: `npx vitest run tests/wealth-inventory.test.ts`
Expected: PASS (5 тестов)

- [ ] **Step 5: Коммит**

```bash
git add lib/wealth/inventory.ts tests/wealth-inventory.test.ts
git commit -m "feat: забор инвентаря по экземплярам предметов"
```

---

### Task 5: Единая база цен в разборе

**Files:**
- Modify: `lib/steam/enrich.ts` (функция `enrichGames`, цены)
- Modify: `lib/steam/types.ts` (`EnrichedGame`)
- Modify: `lib/aggregation/aggregate.ts` (`calculateEconomics`)
- Modify: `lib/aggregation/types.ts` (`economics`)
- Test: `tests/wealth-economics.test.ts`

**Interfaces:**
- Consumes: `getGamePrice` из `@/lib/wealth/store-price`.
- Produces: у `EnrichedGame` появляются `priceSource?: PriceSource` и `enriched?: boolean`; у `economics` — необязательные `currency?: "RUB"`, `pricedGames?: number`, `estimatedGames?: number`, `unknownGames?: number`.

Зачем: сейчас цены берутся из двух источников (магазин для тридцати самых заигранных, базовая цена SteamSpy для остальных) и в долларах. Такая сумма неверна независимо от кошелька. Новые поля — только необязательные: под ключом `profile:v2:` лежат вечные записи покупателей, и старые записи обязаны продолжать читаться.

- [ ] **Step 1: Написать падающий тест**

```ts
// tests/wealth-economics.test.ts
import { describe, it, expect } from "vitest";
import { buildAggregatedProfile } from "@/lib/aggregation/aggregate";
import type { EnrichedGame } from "@/lib/steam/types";
import { player, noBadges, noAchievements, noRecent } from "./fixtures";

function priced(appid: number, rub: number | undefined, playtime: number, enriched = true): EnrichedGame {
  return {
    appid,
    name: `Game ${appid}`,
    playtime_forever: playtime,
    img_icon_url: "icon",
    tags: {},
    genres: [],
    price: rub,
    isFree: false,
    enriched,
    priceSource: rub === undefined ? "none" : "ru",
  };
}

describe("экономика на единой базе цен", () => {
  it("помечает валюту рублями", () => {
    const profile = buildAggregatedProfile(
      player(), [priced(1, 1000, 600), priced(2, 500, 0)], noRecent, 10, [], noBadges, noAchievements,
    );
    expect(profile.economics.currency).toBe("RUB");
    expect(profile.economics.totalLibraryValue).toBe(1500);
    expect(profile.economics.wastedValue).toBe(500);
  });

  it("достраивает хвост сверх потолка средней ценой посчитанных", () => {
    const games = [priced(1, 1000, 600), priced(2, 2000, 600), priced(3, undefined, 60, false)];
    const profile = buildAggregatedProfile(
      player(), games, noRecent, 10, [], noBadges, noAchievements,
    );
    // 1000 + 2000 + средняя 1500 за необогащённую
    expect(profile.economics.totalLibraryValue).toBe(4500);
    expect(profile.economics.estimatedGames).toBe(1);
    expect(profile.economics.pricedGames).toBe(2);
  });

  it("игру без цены, о которой магазин молчал, в сумму не выдумывает", () => {
    const games = [priced(1, 1000, 600), priced(2, undefined, 600, true)];
    const profile = buildAggregatedProfile(
      player(), games, noRecent, 10, [], noBadges, noAchievements,
    );
    expect(profile.economics.totalLibraryValue).toBe(1000);
    expect(profile.economics.unknownGames).toBe(1);
    expect(profile.economics.estimatedGames).toBe(0);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run tests/wealth-economics.test.ts`
Expected: FAIL — `currency`/`estimatedGames` отсутствуют в `economics`.

- [ ] **Step 3: Расширить типы**

```ts
// lib/steam/types.ts — в EnrichedGame добавить:
  /** Откуда взята цена: российский магазин, американский по курсу, ниоткуда. */
  priceSource?: "ru" | "us" | "none";
  /** false — игра из хвоста сверх потолка: цены не спрашивали вовсе. */
  enriched?: boolean;
```

```ts
// lib/aggregation/types.ts — в economics добавить (только необязательные поля:
// под profile:v2 лежат вечные записи покупателей, старые читаются как есть):
    currency?: "RUB";
    pricedGames?: number;
    estimatedGames?: number;
    unknownGames?: number;
```

- [ ] **Step 4: Перевести обогащение на единую цену**

В `lib/steam/enrich.ts`: убрать `parseSteamSpyPrice` и поле `price` из данных SteamSpy, брать цену только из `getGamePrice`. SteamSpy остаётся источником тегов и `average_forever`.

```ts
// lib/steam/enrich.ts — заменить вычисление цены в обеих пачках на:
import { getGamePrice } from "@/lib/wealth/store-price";

// ...в обработке каждой игры (и топовой, и остальной до потолка):
const price = await getGamePrice(game.appid);
return {
  ...game,
  tags,
  genres: storeData.genres,
  price: price.rub,
  isFree: price.isFree,
  priceSource: price.source,
  enriched: true,
  averageForever: spyData?.average_forever,
} as EnrichedGame;

// ...в хвосте сверх потолка (skipped) добавить пометку:
enriched: false,
```

- [ ] **Step 5: Пересчитать экономику**

```ts
// lib/aggregation/aggregate.ts — calculateEconomics
function calculateEconomics(games: EnrichedGame[]): AggregatedProfile["economics"] {
  let totalValue = 0;
  let wastedValue = 0;
  let freeCount = 0;
  let pricedGames = 0;
  let unknownGames = 0;
  const unpricedTail: EnrichedGame[] = [];
  let bestDeal: { name: string; pricePerHour: number } | null = null;

  for (const game of games) {
    if (game.isFree) {
      freeCount++;
      continue;
    }
    if (game.price === undefined) {
      // Хвост сверх потолка достраивается средней ценой: у человека с тысячей
      // игр иначе половина библиотеки молча стоит ноль. А вот игра, о которой
      // магазин промолчал, остаётся неизвестной — выдумывать ей цену нельзя.
      if (game.enriched === false) unpricedTail.push(game);
      else unknownGames++;
      continue;
    }
    const price = game.price;
    pricedGames++;
    totalValue += price;
    if (game.playtime_forever === 0) wastedValue += price;

    const hours = game.playtime_forever / 60;
    if (price > 0 && hours >= MIN_HOURS_FOR_PPH) {
      const pph = price / hours;
      if (!bestDeal || pph < bestDeal.pricePerHour) {
        bestDeal = { name: game.name, pricePerHour: Math.round(pph * 100) / 100 };
      }
    }
  }

  const avgPrice = pricedGames > 0 ? totalValue / pricedGames : 0;
  for (const game of unpricedTail) {
    totalValue += avgPrice;
    if (game.playtime_forever === 0) wastedValue += avgPrice;
  }

  const totalHours = games.reduce((a, g) => a + g.playtime_forever, 0) / 60;
  const perHourCost = totalHours > 0 ? Math.round((totalValue / totalHours) * 100) / 100 : 0;
  const freePercentage = games.length > 0 ? Math.round((freeCount / games.length) * 100) : 0;

  return {
    totalLibraryValue: Math.round(totalValue * 100) / 100,
    wastedValue: Math.round(wastedValue * 100) / 100,
    perHourCost,
    bestDeal,
    freePercentage,
    currency: "RUB",
    pricedGames,
    estimatedGames: unpricedTail.length,
    unknownGames,
  };
}
```

- [ ] **Step 6: Прогнать тесты**

Run: `npx vitest run tests/wealth-economics.test.ts tests/aggregate.test.ts tests/enrich.test.ts`
Expected: PASS. Если `tests/aggregate.test.ts` ждёт долларовых чисел — поправить ожидания в нём, отметив в сообщении коммита, что база цен сменилась.

- [ ] **Step 7: Полная проверка и коммит**

```bash
npm run verify
git add lib/steam/enrich.ts lib/steam/types.ts lib/aggregation/aggregate.ts lib/aggregation/types.ts tests/
git commit -m "fix: стоимость библиотеки на единой рублёвой базе цен"
```

---

### Task 6: Сборщик кошелька

**Files:**
- Create: `lib/wealth/types.ts`
- Create: `lib/wealth/calculate.ts`
- Test: `tests/wealth-calculate.test.ts`

**Interfaces:**
- Consumes: `AggregatedProfile`, `fetchAppInventory`, `INVENTORY_APPS`, `getRates`.
- Produces: `interface Wealth` (см. код), `calculateWealth(profile: AggregatedProfile, steamId64: string): Promise<Wealth>`, `CARD_AVERAGE_RUB: number`.

- [ ] **Step 1: Написать падающий тест**

```ts
// tests/wealth-calculate.test.ts
import { describe, it, expect, vi } from "vitest";
import type { AggregatedProfile } from "@/lib/aggregation/types";

vi.mock("@/lib/wealth/fx", () => ({ getRates: async () => ({ usdRub: 80, eurRub: 100 }), FX_TTL: 1 }));
vi.mock("@/lib/wealth/inventory", () => ({
  INVENTORY_APPS: [
    { appId: 730, contextId: 2, priced: true },
    { appId: 753, contextId: 6, priced: false },
  ],
  fetchAppInventory: async (_id: string, appId: number) =>
    appId === 730
      ? {
          appId,
          status: "ok",
          totalEur: 20,
          itemCount: 3,
          items: [
            { name: "Нож", qty: 1, priceEur: 15, marketable: true },
            { name: "Ящик", qty: 2, priceEur: 2.5, marketable: true },
            { name: "10 Year Veteran Coin", qty: 1, marketable: false },
          ],
        }
      : { appId, status: "ok", totalEur: 0, itemCount: 10, items: [] },
}));

function profile(overrides: Partial<AggregatedProfile["economics"]> = {}): AggregatedProfile {
  return {
    stats: { totalGames: 100, totalPlaytimeHours: 1000 },
    economics: {
      totalLibraryValue: 200000,
      wastedValue: 20000,
      perHourCost: 200,
      bestDeal: null,
      freePercentage: 10,
      currency: "RUB",
      ...overrides,
    },
  } as unknown as AggregatedProfile;
}

describe("сборщик кошелька", () => {
  it("складывает библиотеку и инвентарь в рублях", async () => {
    const { calculateWealth, CARD_AVERAGE_RUB } = await import("@/lib/wealth/calculate");
    const wealth = await calculateWealth(profile(), "1");

    expect(wealth.library.total).toBe(200000);
    expect(wealth.library.avgPrice).toBe(2000);
    // 20 евро по 100 плюс десять карточек по средней цене
    expect(wealth.inventory.total).toBeCloseTo(2000 + 10 * CARD_AVERAGE_RUB, 2);
    expect(wealth.total).toBeCloseTo(202000 + 10 * CARD_AVERAGE_RUB, 2);
    expect(wealth.complete).toBe(true);
  });

  it("пересчитывает старую долларовую экономику по курсу", async () => {
    const { calculateWealth } = await import("@/lib/wealth/calculate");
    const wealth = await calculateWealth(profile({ currency: undefined, totalLibraryValue: 2500 }), "1");
    expect(wealth.library.total).toBe(200000);
  });

  it("показывает самые дорогие предметы и невыставляемые отдельно", async () => {
    const { calculateWealth } = await import("@/lib/wealth/calculate");
    const wealth = await calculateWealth(profile(), "1");
    expect(wealth.inventory.top[0].name).toBe("Нож");
    expect(wealth.inventory.notable).toContain("10 Year Veteran Coin");
  });

  it("закрытый инвентарь делает расчёт неполным, но не пустым", async () => {
    vi.doMock("@/lib/wealth/inventory", () => ({
      INVENTORY_APPS: [{ appId: 730, contextId: 2, priced: true }],
      fetchAppInventory: async () => ({ appId: 730, status: "private", totalEur: 0, itemCount: 0, items: [] }),
    }));
    vi.resetModules();
    const { calculateWealth } = await import("@/lib/wealth/calculate");
    const wealth = await calculateWealth(profile(), "1");
    expect(wealth.inventory.status).toBe("private");
    expect(wealth.complete).toBe(false);
    expect(wealth.library.total).toBe(200000);
    vi.doUnmock("@/lib/wealth/inventory");
    vi.resetModules();
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run tests/wealth-calculate.test.ts`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Описать форму данных**

```ts
// lib/wealth/types.ts
import type { InventoryStatus } from "@/lib/wealth/inventory";

export interface WealthItem {
  name: string;
  qty: number;
  rub: number;
}

export interface Wealth {
  currency: "RUB";
  /** Библиотека плюс инвентарь. */
  total: number;
  library: {
    total: number;
    avgPrice: number;
    perHour: number;
    /** Часть суммы достроена по средней цене — это надо подписать на витрине. */
    estimated: boolean;
    unknownGames: number;
  };
  unplayed: {
    value: number;
  };
  inventory: {
    status: InventoryStatus;
    total: number;
    itemCount: number;
    top: WealthItem[];
    /** Невыставляемые вещи: в сумму не идут, но говорят о человеке. */
    notable: string[];
    /** Карточки и эмоции посчитаны по средней цене, а не по рынку. */
    cardsEstimated: number;
  };
  /** Полный расчёт хранится долго, неполный — час. */
  complete: boolean;
}
```

- [ ] **Step 4: Написать сборщик**

```ts
// lib/wealth/calculate.ts
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
```

- [ ] **Step 5: Убедиться, что тест проходит**

Run: `npx vitest run tests/wealth-calculate.test.ts`
Expected: PASS (4 теста)

- [ ] **Step 6: Коммит**

```bash
git add lib/wealth/types.ts lib/wealth/calculate.ts tests/wealth-calculate.test.ts
git commit -m "feat: сборщик кошелька — библиотека плюс инвентарь"
```

---

### Task 7: Хранение кошелька

**Files:**
- Create: `lib/wealth/store.ts`
- Modify: `lib/cache/keys.ts` (ключ и срок)
- Modify: `lib/cache/redis.ts:98` (`PERSISTENT_PREFIXES`)
- Test: `tests/wealth-store.test.ts`

**Interfaces:**
- Consumes: `calculateWealth`, `getCache`/`setCache`, `paywallMode`, `steamIdHasEntitlement`.
- Produces: `getWealth(profile: AggregatedProfile, steamId64: string): Promise<Wealth>`, `wealthKey(steamId64: string): string`, `CACHE_TTL.wealthPartial`.

- [ ] **Step 1: Написать падающий тест**

```ts
// tests/wealth-store.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AggregatedProfile } from "@/lib/aggregation/types";
import type { Wealth } from "@/lib/wealth/types";

const cache = new Map<string, { value: unknown; ttl: number }>();
vi.mock("@/lib/cache/redis", () => ({
  getCache: async (key: string) => cache.get(key)?.value ?? null,
  setCache: async (key: string, value: unknown, ttl: number) => void cache.set(key, { value, ttl }),
}));

const calculateWealth = vi.fn();
vi.mock("@/lib/wealth/calculate", () => ({ calculateWealth, CARD_AVERAGE_RUB: 6.15 }));

const hasEntitlement = vi.fn(() => false);
vi.mock("@/lib/billing/store", () => ({ steamIdHasEntitlement: hasEntitlement }));

const mode = vi.fn(() => "stub");
vi.mock("@/lib/access/entitlement", () => ({ paywallMode: mode }));

const profile = {} as AggregatedProfile;
const wealth = (complete: boolean) => ({ complete, total: 1 }) as Wealth;

beforeEach(() => {
  cache.clear();
  calculateWealth.mockReset();
  hasEntitlement.mockReturnValue(false);
  mode.mockReturnValue("stub");
});

describe("хранение кошелька", () => {
  it("второй показ не считает заново", async () => {
    calculateWealth.mockResolvedValue(wealth(true));
    const { getWealth } = await import("@/lib/wealth/store");
    await getWealth(profile, "77");
    await getWealth(profile, "77");
    expect(calculateWealth).toHaveBeenCalledTimes(1);
  });

  it("оплаченный разбор хранит кошелёк вечно", async () => {
    hasEntitlement.mockReturnValue(true);
    calculateWealth.mockResolvedValue(wealth(true));
    const { getWealth } = await import("@/lib/wealth/store");
    const { CACHE_TTL, wealthKey } = await import("@/lib/cache/keys");
    await getWealth(profile, "77");
    expect(cache.get(wealthKey("77"))?.ttl).toBe(CACHE_TTL.purchased);
  });

  it("при выключенной кассе срок обычный, в базу заказов не ходим", async () => {
    mode.mockReturnValue("off");
    calculateWealth.mockResolvedValue(wealth(true));
    const { getWealth } = await import("@/lib/wealth/store");
    const { CACHE_TTL, wealthKey } = await import("@/lib/cache/keys");
    await getWealth(profile, "77");
    expect(cache.get(wealthKey("77"))?.ttl).toBe(CACHE_TTL.aggregatedProfile);
    expect(hasEntitlement).not.toHaveBeenCalled();
  });

  it("неполный расчёт живёт час — человек мог открыть инвентарь", async () => {
    hasEntitlement.mockReturnValue(true);
    calculateWealth.mockResolvedValue(wealth(false));
    const { getWealth } = await import("@/lib/wealth/store");
    const { CACHE_TTL, wealthKey } = await import("@/lib/cache/keys");
    await getWealth(profile, "77");
    expect(cache.get(wealthKey("77"))?.ttl).toBe(CACHE_TTL.wealthPartial);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run tests/wealth-store.test.ts`
Expected: FAIL — нет `wealthKey`/`getWealth`.

- [ ] **Step 3: Добавить ключ и срок**

```ts
// lib/cache/keys.ts — в CACHE_TTL добавить:
  /**
   * Неполный кошелёк: инвентарь закрыт, рынок молчал или курс не пришёл.
   * Час, а не сутки: настройку приватности человек меняет между визитами, и
   * запоминать отказ надолго значит врать после того, как он инвентарь открыл.
   */
  wealthPartial: 3600,

// и рядом с остальными ключами:
export function wealthKey(steamId64: string): string {
  return `wealth:v1:${steamId64}`;
}
```

```ts
// lib/cache/redis.ts:98 — добавить префикс в список переживающих перезапуск:
const PERSISTENT_PREFIXES = ["gate:", "profile:", "cardstats:", "rarity:", "portrait:", "art:identity:", "wealth:"];
```

- [ ] **Step 4: Написать хранилище**

```ts
// lib/wealth/store.ts
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

  const purchased = paywallMode() !== "off" && steamIdHasEntitlement(steamId64);
  const ttl = !wealth.complete
    ? CACHE_TTL.wealthPartial
    : purchased
      ? CACHE_TTL.purchased
      : CACHE_TTL.aggregatedProfile;

  await setCache(key, wealth, ttl);
  return wealth;
}
```

- [ ] **Step 5: Убедиться, что тест проходит**

Run: `npx vitest run tests/wealth-store.test.ts`
Expected: PASS (4 теста)

- [ ] **Step 6: Коммит**

```bash
git add lib/wealth/store.ts lib/cache/keys.ts lib/cache/redis.ts tests/wealth-store.test.ts
git commit -m "feat: кошелёк отдельной записью кеша со своим сроком"
```

---

### Task 8: Витрина кошелька

**Files:**
- Create: `components/DeepDive/WealthCard.tsx`
- Modify: `app/[locale]/result/[id]/page.tsx` (расчёт при полном доступе)
- Modify: `components/ResultTabs.tsx` (проп и отрисовка во вкладке `deepdive`)
- Modify: `messages/ru.json`, `messages/en.json`
- Test: `tests/wealth-page.test.ts`

**Interfaces:**
- Consumes: `getWealth` из `@/lib/wealth/store`, `Wealth` из `@/lib/wealth/types`.
- Produces: компонент `WealthCard({ wealth, labels })`; у `ResultTabs` появляется необязательный проп `wealth?: Wealth | null`.

- [ ] **Step 1: Написать падающий тест**

```ts
// tests/wealth-page.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import ru from "@/messages/ru.json";
import en from "@/messages/en.json";

const page = readFileSync("app/[locale]/result/[id]/page.tsx", "utf8");
const tabs = readFileSync("components/ResultTabs.tsx", "utf8");

describe("витрина кошелька", () => {
  it("кошелёк считается только при полном доступе", () => {
    // Расчёт стоит ПОСЛЕ ветки, которая отдаёт бесплатный вид: до неё он гонял
    // бы четыре запроса в Steam на каждого посетителя, включая неплательщиков.
    const free = page.indexOf('access !== "full"');
    const wealth = page.indexOf("getWealth(");
    expect(free).toBeGreaterThan(-1);
    expect(wealth).toBeGreaterThan(free);
  });

  it("бесплатный вид кошелька не получает", () => {
    const freeBlock = page.slice(page.indexOf("<FreeResult"), page.indexOf("/>", page.indexOf("<FreeResult")));
    expect(freeBlock).not.toContain("wealth");
  });

  it("витрина живёт во вкладке глубокого погружения", () => {
    expect(tabs).toContain("WealthCard");
  });

  it("подписи есть на обоих языках", () => {
    for (const messages of [ru, en]) {
      const wealth = (messages as Record<string, Record<string, unknown>>).deepDive.wealth as Record<string, string>;
      for (const key of ["title", "library", "inventory", "unplayed", "perHour", "avgPrice",
                         "marketNote", "estimatedNote", "privateInventory", "cards"]) {
        expect(wealth[key]).toBeTruthy();
      }
    }
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run tests/wealth-page.test.ts`
Expected: FAIL — ни `getWealth` на странице, ни ключей в переводах.

- [ ] **Step 3: Добавить подписи**

```jsonc
// messages/ru.json → deepDive.wealth
"wealth": {
  "title": "Кошелёк",
  "accountValue": "Стоимость аккаунта",
  "library": "Библиотека",
  "inventory": "Инвентарь",
  "unplayed": "Деньги в непройденном",
  "perHour": "Цена часа",
  "avgPrice": "Средняя цена игры",
  "cards": "Карточки и эмоции",
  "notable": "Особые предметы",
  "marketNote": "Инвентарь оценён по ценам быстрой продажи на стороннем рынке; внутри Steam эти вещи стоят дороже примерно на четверть",
  "estimatedNote": "Часть суммы оценена по средней цене",
  "privateInventory": "Инвентарь закрыт настройками приватности",
  "storeNote": "Цены Steam для России на сегодня"
}
```

```jsonc
// messages/en.json → deepDive.wealth
"wealth": {
  "title": "Wallet",
  "accountValue": "Account value",
  "library": "Library",
  "inventory": "Inventory",
  "unplayed": "Money in unplayed games",
  "perHour": "Cost per hour",
  "avgPrice": "Average game price",
  "cards": "Cards and emoticons",
  "notable": "Notable items",
  "marketNote": "Inventory is valued at quick-sale prices on a third-party market; inside Steam these items cost about a quarter more",
  "estimatedNote": "Part of the total is estimated from the average price",
  "privateInventory": "Inventory is private",
  "storeNote": "Steam prices for Russia, today"
}
```

- [ ] **Step 4: Написать компонент**

```tsx
// components/DeepDive/WealthCard.tsx
import type { Wealth } from "@/lib/wealth/types";

interface Labels {
  title: string;
  accountValue: string;
  library: string;
  inventory: string;
  unplayed: string;
  perHour: string;
  avgPrice: string;
  cards: string;
  notable: string;
  marketNote: string;
  estimatedNote: string;
  privateInventory: string;
  storeNote: string;
}

const rub = (value: number) => `${Math.round(value).toLocaleString("ru-RU")} ₽`;

export function WealthCard({ wealth, labels }: { wealth: Wealth; labels: Labels }) {
  return (
    <div className="rounded-2xl bg-white/5 p-5 space-y-4">
      <div className="text-sm text-gray-400">{labels.title}</div>

      <div>
        <div className="text-sm text-gray-400">{labels.accountValue}</div>
        <div className="text-4xl font-bold text-green-400">{rub(wealth.total)}</div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <Stat label={labels.library} value={rub(wealth.library.total)} />
        <Stat
          label={labels.inventory}
          value={wealth.inventory.status === "ok" ? rub(wealth.inventory.total) : "—"}
        />
        <Stat label={labels.unplayed} value={rub(wealth.unplayed.value)} />
        <Stat label={labels.perHour} value={rub(wealth.library.perHour)} />
        <Stat label={labels.avgPrice} value={rub(wealth.library.avgPrice)} />
        {wealth.inventory.cardsEstimated > 0 && (
          <Stat label={labels.cards} value={`${wealth.inventory.cardsEstimated}`} />
        )}
      </div>

      {wealth.inventory.top.length > 0 && (
        <ul className="space-y-1 text-sm">
          {wealth.inventory.top.map((item) => (
            <li key={item.name} className="flex justify-between gap-3">
              <span className="text-gray-300 truncate">
                {item.qty > 1 ? `${item.qty}× ` : ""}
                {item.name}
              </span>
              <span className="text-gray-100 shrink-0">{rub(item.rub * item.qty)}</span>
            </li>
          ))}
        </ul>
      )}

      {wealth.inventory.notable.length > 0 && (
        <div className="text-sm text-gray-400">
          {labels.notable}: {wealth.inventory.notable.join(", ")}
        </div>
      )}

      <div className="space-y-1 text-xs text-gray-400">
        <div>{labels.storeNote}</div>
        {wealth.inventory.status === "private" ? (
          <div>{labels.privateInventory}</div>
        ) : (
          <div>{labels.marketNote}</div>
        )}
        {wealth.library.estimated && <div>{labels.estimatedNote}</div>}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-gray-400">{label}</div>
      <div className="text-lg font-semibold text-gray-100">{value}</div>
    </div>
  );
}
```

- [ ] **Step 5: Подключить к странице**

```tsx
// app/[locale]/result/[id]/page.tsx
// рядом с остальными импортами:
import { getWealth } from "@/lib/wealth/store";

// ПОСЛЕ ветки `if (access !== "full") { ... return <FreeResult ... /> }`,
// перед возвратом полного вида:
//
// Кошелёк считается только здесь: до этой строки живут те, кто не платил, и
// четыре запроса в Steam за инвентарём на каждого из них — прямой путь упереться
// в лимит Steam по адресу. Отказ кошелька не должен ронять оплаченную страницу.
let wealth = null;
try {
  wealth = await getWealth(profile, params.id);
} catch (err) {
  console.error("[wealth] расчёт не удался:", err);
}

// и в <ResultTabs ...> добавить проп:
        wealth={wealth}
```

```tsx
// components/ResultTabs.tsx
// импорт:
import { WealthCard } from "./DeepDive/WealthCard";
import type { Wealth } from "@/lib/wealth/types";

// в ResultTabsProps:
  wealth?: Wealth | null;

// в сигнатуре компонента:
export function ResultTabs({ portrait, profile, steamId64, locale, isOwner = false, wealth = null }: ResultTabsProps) {

// во вкладке deepdive — ПЕРВЫМ блоком, выше <EconomicsCard ...>:
                {wealth && (
                  <WealthCard
                    wealth={wealth}
                    labels={{
                      title: t("deepDive.wealth.title"),
                      accountValue: t("deepDive.wealth.accountValue"),
                      library: t("deepDive.wealth.library"),
                      inventory: t("deepDive.wealth.inventory"),
                      unplayed: t("deepDive.wealth.unplayed"),
                      perHour: t("deepDive.wealth.perHour"),
                      avgPrice: t("deepDive.wealth.avgPrice"),
                      cards: t("deepDive.wealth.cards"),
                      notable: t("deepDive.wealth.notable"),
                      marketNote: t("deepDive.wealth.marketNote"),
                      estimatedNote: t("deepDive.wealth.estimatedNote"),
                      privateInventory: t("deepDive.wealth.privateInventory"),
                      storeNote: t("deepDive.wealth.storeNote"),
                    }}
                  />
                )}
```

- [ ] **Step 6: Прогнать тесты**

Run: `npx vitest run tests/wealth-page.test.ts tests/redact.test.ts tests/generate-free.test.ts`
Expected: PASS — кошелёк не просачивается в бесплатный вид.

- [ ] **Step 7: Полная проверка и коммит**

```bash
npm run verify
git add components/DeepDive/WealthCard.tsx components/ResultTabs.tsx "app/[locale]/result/[id]/page.tsx" messages/ tests/wealth-page.test.ts
git commit -m "feat: витрина кошелька во вкладке глубокого погружения"
```

---

## Финальная проверка

- [ ] `npm run verify` — типы, линтер, все тесты зелёные.
- [ ] Ручная проверка на живом профиле `76561198140642959`: инвентарь CS2 и Dota считается, сумма в рублях правдоподобна (по замеру 2026-08-11 — около 7 400 ₽ по рынку плюс карточки).
- [ ] Проверить закрытый инвентарь на профиле `76561197960287930`: блок показывает библиотеку и «инвентарь закрыт», страница цела.
- [ ] Убедиться, что бесплатный вид разбора цифр кошелька не содержит: открыть исходник страницы без доступа и поискать «Кошелёк».
