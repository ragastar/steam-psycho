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

    expect(wealth.library?.total).toBe(200000);
    expect(wealth.library?.avgPrice).toBe(2000);
    // 20 евро по 100 плюс десять карточек по средней цене
    expect(wealth.inventory.total).toBeCloseTo(2000 + 10 * CARD_AVERAGE_RUB, 2);
    expect(wealth.total).toBeCloseTo(202000 + 10 * CARD_AVERAGE_RUB, 2);
    expect(wealth.complete).toBe(true);
  });

  it("не выдумывает стоимость библиотеки по разбору старой формы", async () => {
    // Разбор без метки валюты сделан до перехода на единую рублёвую базу. Его
    // сумма посчитана прежней смесью (магазин для верхушки, сторонний сервис
    // для остальных, доллары) — ровно тем, ради замены чего база и менялась.
    // Пересчёт такой суммы по курсу давал на боевом «стоимость аккаунта
    // 2 099 036 ₽» при настоящих десятках тысяч. Пока разбор не пересчитан,
    // библиотеки в кошельке нет вовсе, и расчёт считается неполным — значит
    // хранится час, а не десять лет.
    const { calculateWealth } = await import("@/lib/wealth/calculate");
    const wealth = await calculateWealth(profile({ currency: undefined, totalLibraryValue: 2500 }), "1");

    expect(wealth.library).toBeNull();
    expect(wealth.unplayed).toBeNull();
    expect(wealth.total).toBe(wealth.inventory.total);
    expect(wealth.complete).toBe(false);
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
    expect(wealth.library?.total).toBe(200000);
    vi.doUnmock("@/lib/wealth/inventory");
    vi.resetModules();
  });

  it("стопка дешёвых копий обгоняет дорогую поштучно вещь, если стоит дороже в сумме", async () => {
    vi.doMock("@/lib/wealth/inventory", () => ({
      INVENTORY_APPS: [{ appId: 730, contextId: 2, priced: true }],
      fetchAppInventory: async () => ({
        appId: 730,
        status: "ok",
        totalEur: 0.35,
        itemCount: 21,
        items: [
          // 20 копий по 1 ₽ — стопка стоит 20 ₽
          { name: "Наклейка", qty: 20, priceEur: 0.01, marketable: true },
          // 1 копия по 15 ₽ — штучно дороже, но стопкой дешевле
          { name: "Нож", qty: 1, priceEur: 0.15, marketable: true },
        ],
      }),
    }));
    vi.resetModules();
    const { calculateWealth } = await import("@/lib/wealth/calculate");
    const wealth = await calculateWealth(profile(), "1");

    expect(wealth.inventory.top[0].name).toBe("Наклейка");
    expect(wealth.inventory.top[0].unitRub).toBeCloseTo(1, 2);
    expect(wealth.inventory.top[0].totalRub).toBeCloseTo(20, 2);
    expect(wealth.inventory.top[1].name).toBe("Нож");
    expect(wealth.inventory.top[1].unitRub).toBeCloseTo(15, 2);
    expect(wealth.inventory.top[1].totalRub).toBeCloseTo(15, 2);

    vi.doUnmock("@/lib/wealth/inventory");
    vi.resetModules();
  });

  it("выставляемый предмет без цены в прайс-листе не пропадает молча", async () => {
    vi.doMock("@/lib/wealth/inventory", () => ({
      INVENTORY_APPS: [{ appId: 730, contextId: 2, priced: true }],
      fetchAppInventory: async () => ({
        appId: 730,
        status: "ok",
        totalEur: 15,
        itemCount: 4,
        items: [
          { name: "Нож", qty: 1, priceEur: 15, marketable: true },
          // Выставляемый, но рынок цену не знает — не должен пропасть с витрины
          { name: "Загадочный шеврон", qty: 3, marketable: true },
        ],
      }),
    }));
    vi.resetModules();
    const { calculateWealth } = await import("@/lib/wealth/calculate");
    const wealth = await calculateWealth(profile(), "1");

    expect(wealth.inventory.unpricedItems).toBe(3);
    // Сумма считается по totalEur из инвентаря (15 евро * 100 = 1500 ₽) — шеврон в цену не входит
    expect(wealth.inventory.total).toBeCloseTo(1500, 2);
    expect(wealth.inventory.notable).not.toContain("Загадочный шеврон");
    expect(wealth.inventory.top.map((item) => item.name)).not.toContain("Загадочный шеврон");

    vi.doUnmock("@/lib/wealth/inventory");
    vi.resetModules();
  });
});
