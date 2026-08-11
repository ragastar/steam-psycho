import { describe, it, expect, afterEach, vi } from "vitest";
import { incrementRateLimit } from "@/lib/cache/redis";

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Ограничитель общий: на нём висят разбор библиотеки, генерация картинки и
 * приём кода входа. Upstash не настроен, поэтому в проде работает ветка в
 * памяти — она и проверяется.
 */
describe("ограничитель частоты в памяти", () => {
  it("срок корзины ставится один раз и попытками внутри окна не продлевается", async () => {
    // Раньше каждая попытка переставляла срок корзины на час вперёд, то есть
    // окно было скользящим: исчерпанный лимит не отпускал никого, пока в него
    // хоть кто-то стучится чаще раза в час — а стучатся ровно потому, что им
    // отказали. Окно должно быть фиксированным, как в ветке Redis.
    const key = "ratelimit:тест:окно";
    vi.useFakeTimers({ toFake: ["Date"] });
    const t0 = new Date("2026-08-11T10:00:00Z").getTime();
    vi.setSystemTime(t0);

    expect(await incrementRateLimit(key, 3600)).toBe(1);

    vi.setSystemTime(t0 + 30 * 60_000);
    expect(await incrementRateLimit(key, 3600)).toBe(2);

    vi.setSystemTime(t0 + 59 * 60_000);
    expect(await incrementRateLimit(key, 3600)).toBe(3);

    // Час от ПЕРВОЙ попытки истёк — счёт начинается заново, несмотря на то
    // что стучались всё это время.
    vi.setSystemTime(t0 + 3600_000 + 1000);
    expect(await incrementRateLimit(key, 3600)).toBe(1);
  });

  it("разные корзины друг друга не задевают", async () => {
    expect(await incrementRateLimit("ratelimit:тест:первый", 3600)).toBe(1);
    expect(await incrementRateLimit("ratelimit:тест:второй", 3600)).toBe(1);
    expect(await incrementRateLimit("ratelimit:тест:первый", 3600)).toBe(2);
  });
});
