import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchSpy = vi.fn();
vi.stubGlobal("fetch", fetchSpy);
vi.mock("@/lib/cache/redis", () => ({
  cached: async (_k: string, _t: number, fetcher: () => Promise<unknown>) => fetcher(),
}));

beforeEach(() => {
  fetchSpy.mockReset();
  vi.resetModules();
});

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
