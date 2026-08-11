import Database from "better-sqlite3";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * Как в tests/identity-store.test.ts: соединение кешируется в модуле, поэтому
 * каждому тесту нужна своя база И свежий импорт модуля. Заказы и права живут
 * в том же файле, что и аккаунты (lib/billing/db.ts берёт готовое соединение
 * из lib/identity/db.ts), поэтому свежую базу подставляем через тот же
 * IDENTITY_DB_PATH и заодно поднимаем identity-store — orders.account_id
 * ссылается на реальную строку accounts (FK), выдуманный id не пройдёт.
 */
async function freshStores(dbPath: string) {
  process.env.IDENTITY_DB_PATH = dbPath;
  vi.resetModules();
  const identity = await import("@/lib/identity/store");
  const billing = await import("@/lib/billing/store");
  return { identity, billing };
}

let nextTelegramId = 1;

/** Заводит настоящий аккаунт через identity-store и возвращает его id. */
function makeAccount(identity: Awaited<ReturnType<typeof freshStores>>["identity"]): number {
  const res = identity.loginOrCreate("telegram", `tg-${nextTelegramId++}`);
  if (res.status !== "ok") throw new Error("не удалось завести тестовый аккаунт");
  return res.accountId;
}

let dbPath: string;

beforeEach(() => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "billing-")), "billing.db");
  nextTelegramId = 1;
});

afterEach(() => {
  delete process.env.IDENTITY_DB_PATH;
  vi.resetModules();
});

/** Считает права напрямую в базе — независимая проверка от store. */
function countEntitlements(dbPath: string): number {
  const raw = new Database(dbPath);
  try {
    const row = raw.prepare("SELECT COUNT(*) AS n FROM entitlements").get() as { n: number };
    return row.n;
  } finally {
    raw.close();
  }
}

describe("хранилище заказов и прав", () => {
  it("заказ создаётся и находится по номеру, статус created", async () => {
    const { identity, billing } = await freshStores(dbPath);
    const accountId = makeAccount(identity);

    const created = billing.createOrder({
      accountId,
      steamId64: "76561197990915489",
      amountKop: 19900,
      provider: "stub",
      idempotencyKey: "order-1",
    });

    expect(created).not.toBeNull();
    const order = billing.findOrder(created!.id);
    expect(order).not.toBeNull();
    expect(order!.status).toBe("created");
    expect(order!.accountId).toBe(accountId);
    expect(order!.steamId64).toBe("76561197990915489");
    expect(order!.amountKop).toBe(19900);
    expect(order!.provider).toBe("stub");
    expect(order!.currency).toBe("RUB");
  });

  it("markPaid выдаёт право и переводит заказ в paid", async () => {
    const { identity, billing } = await freshStores(dbPath);
    const accountId = makeAccount(identity);
    const created = billing.createOrder({
      accountId,
      steamId64: "76561197990915489",
      amountKop: 19900,
      provider: "stub",
      idempotencyKey: "order-2",
    });

    const result = billing.markPaid(created!.id, "provider-order-1");

    expect(result).toBe("granted");
    expect(billing.hasEntitlement(accountId, "76561197990915489")).toBe(true);
    expect(billing.findOrder(created!.id)!.status).toBe("paid");
  });

  it("повторный markPaid того же заказа возвращает already и не создаёт второе право", async () => {
    const { identity, billing } = await freshStores(dbPath);
    const accountId = makeAccount(identity);
    const created = billing.createOrder({
      accountId,
      steamId64: "76561197990915489",
      amountKop: 19900,
      provider: "stub",
      idempotencyKey: "order-3",
    });

    const first = billing.markPaid(created!.id, "provider-order-1");
    const second = billing.markPaid(created!.id, "provider-order-1");

    expect(first).toBe("granted");
    expect(second).toBe("already");
    expect(countEntitlements(dbPath)).toBe(1);
    expect(billing.hasEntitlement(accountId, "76561197990915489")).toBe(true);
  });

  it("markPaid неизвестного заказа возвращает unknown и ничего не выдаёт", async () => {
    const { billing } = await freshStores(dbPath);

    const result = billing.markPaid(999999, "provider-order-x");

    expect(result).toBe("unknown");
    expect(countEntitlements(dbPath)).toBe(0);
  });

  it("тот же idempotencyKey второй раз не создаёт второй заказ", async () => {
    const { identity, billing } = await freshStores(dbPath);
    const accountId = makeAccount(identity);

    const first = billing.createOrder({
      accountId,
      steamId64: "76561197990915489",
      amountKop: 19900,
      provider: "stub",
      idempotencyKey: "same-key",
    });
    const second = billing.createOrder({
      accountId,
      steamId64: "76561197990915489",
      amountKop: 19900,
      provider: "stub",
      idempotencyKey: "same-key",
    });

    expect(second).toEqual(first);
  });

  it("hasEntitlement — false для чужого аккаунта и для другого steamId того же аккаунта", async () => {
    const { identity, billing } = await freshStores(dbPath);
    const accountId = makeAccount(identity);
    const otherAccountId = makeAccount(identity);
    const created = billing.createOrder({
      accountId,
      steamId64: "76561197990915489",
      amountKop: 19900,
      provider: "stub",
      idempotencyKey: "order-4",
    });
    billing.markPaid(created!.id, "provider-order-1");

    expect(billing.hasEntitlement(otherAccountId, "76561197990915489")).toBe(false);
    expect(billing.hasEntitlement(accountId, "11111111111111111")).toBe(false);
  });

  it("findOpenOrder находит незакрытый заказ и не видит оплаченный", async () => {
    const { identity, billing } = await freshStores(dbPath);
    const accountId = makeAccount(identity);
    const created = billing.createOrder({
      accountId,
      steamId64: "76561197990915489",
      amountKop: 19900,
      provider: "stub",
      idempotencyKey: "order-5",
    });

    expect(billing.findOpenOrder(accountId, "76561197990915489")?.id).toBe(created!.id);

    billing.markPaid(created!.id, "provider-order-1");

    expect(billing.findOpenOrder(accountId, "76561197990915489")).toBeNull();
  });
});

describe("недоступная база закрывает доступ, а не открывает", () => {
  /** Путь, который нельзя открыть: каталога не существует. */
  const brokenPath = "/nonexistent-dir-для-теста/billing.db";

  it("createOrder, markPaid, hasEntitlement возвращают безопасные значения без исключений", async () => {
    const { billing } = await freshStores(brokenPath);

    expect(
      billing.createOrder({
        accountId: 1,
        steamId64: "76561197990915489",
        amountKop: 19900,
        provider: "stub",
        idempotencyKey: "order-broken",
      }),
    ).toBeNull();
    expect(billing.findOrder(1)).toBeNull();
    expect(billing.markPaid(1, "provider-order-1")).toBe("unknown");
    expect(billing.hasEntitlement(1, "76561197990915489")).toBe(false);
    expect(billing.findOpenOrder(1, "76561197990915489")).toBeNull();
  });
});
