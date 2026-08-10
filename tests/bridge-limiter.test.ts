import { describe, it, expect } from "vitest";
import { createLimiter } from "../tools/llm-bridge/limiter.mjs";

/** Обещание, которое разрешают снаружи — так тест управляет «долгими» задачами. */
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe("ограничитель одновременных вызовов моста", () => {
  it("больше maxConcurrent одновременно не запускает", async () => {
    const limiter = createLimiter({ maxConcurrent: 2, queueMax: 5 });
    const gates = [deferred(), deferred(), deferred()];
    let started = 0;

    gates.forEach((g) => limiter.run(() => { started++; return g.promise; }));
    await Promise.resolve();

    expect(started).toBe(2);
    expect(limiter.stats()).toEqual({ active: 2, waiting: 1 });
  });

  it("освободившийся слот забирает ожидающий", async () => {
    const limiter = createLimiter({ maxConcurrent: 1, queueMax: 5 });
    const first = deferred();
    let secondStarted = false;

    const a = limiter.run(() => first.promise);
    const b = limiter.run(() => { secondStarted = true; return Promise.resolve("готово"); });

    expect(secondStarted).toBe(false);
    first.resolve();
    await a;
    await expect(b).resolves.toBe("готово");
    expect(secondStarted).toBe(true);
  });

  it("при полной очереди отказывает сразу, а не копит ожидающих", async () => {
    const limiter = createLimiter({ maxConcurrent: 1, queueMax: 1 });
    const gate = deferred();

    limiter.run(() => gate.promise);
    limiter.run(() => gate.promise);
    const third = limiter.run(() => gate.promise);

    await expect(third).rejects.toMatchObject({ code: "BUSY" });
    gate.resolve();
  });

  it("падение задачи освобождает слот", async () => {
    const limiter = createLimiter({ maxConcurrent: 1, queueMax: 5 });

    await expect(limiter.run(() => Promise.reject(new Error("бум")))).rejects.toThrow("бум");
    await expect(limiter.run(() => Promise.resolve("ок"))).resolves.toBe("ок");
    expect(limiter.stats()).toEqual({ active: 0, waiting: 0 });
  });

  describe("невалидная настройка не должна вешать вызовы", () => {
    it("maxConcurrent = 0 не создаёт ограничитель, который вечно висит", () => {
      // Раньше: active (0) >= maxConcurrent (0) истинно всегда, задача из
      // очереди никогда не достаётся, run() принимает вызов и обещание
      // не разрешается и не отклоняется никогда. Теперь — падаем сразу
      // при создании, понятной ошибкой.
      expect(() => createLimiter({ maxConcurrent: 0, queueMax: 5 })).toThrow();
    });

    it("отрицательный maxConcurrent тоже невалиден", () => {
      expect(() => createLimiter({ maxConcurrent: -1, queueMax: 5 })).toThrow();
    });

    it("NaN из Number(undefined) — типичный итог плохой переменной окружения", () => {
      expect(() => createLimiter({ maxConcurrent: Number(undefined), queueMax: 5 })).toThrow();
    });

    it("NaN в queueMax тоже невалиден (иначе очередь растёт без предела)", () => {
      expect(() => createLimiter({ maxConcurrent: 2, queueMax: Number(undefined) })).toThrow();
    });

    it("отрицательный queueMax невалиден", () => {
      expect(() => createLimiter({ maxConcurrent: 2, queueMax: -1 })).toThrow();
    });
  });
});
