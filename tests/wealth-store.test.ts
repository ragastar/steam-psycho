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
  hasEntitlement.mockClear();
  hasEntitlement.mockReturnValue(false);
  mode.mockClear();
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
