import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * Проверка доступа — единственное место, решающее, кому показывать платное.
 * Поэтому тест идёт не по заглушкам, а по настоящей цепочке: кука сессии →
 * аккаунт → право в базе. Подменяется только браузерное хранилище кук,
 * которого в node нет.
 */
const cookieJar = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieJar.get(name);
      return value === undefined ? undefined : { name, value };
    },
  }),
}));

const STEAM_ID = "76561198000000001";
const OTHER_STEAM_ID = "76561198000000002";

/**
 * Модули читают путь к базе при первом импорте, поэтому на каждый тест —
 * свежий реестр модулей и свой файл базы.
 */
async function load(dbPath: string) {
  process.env.IDENTITY_DB_PATH = dbPath;
  vi.resetModules();
  return {
    access: await import("@/lib/access/entitlement"),
    identity: await import("@/lib/identity/store"),
    session: await import("@/lib/identity/session"),
    billing: await import("@/lib/billing/store"),
  };
}

type Loaded = Awaited<ReturnType<typeof load>>;

/** Заводит аккаунт и кладёт его куку сессии в подставной браузер. */
function signIn(mods: Loaded, providerId: string): number {
  const res = mods.identity.loginOrCreate("telegram", providerId);
  if (res.status !== "ok") throw new Error(`не удалось завести аккаунт: ${res.status}`);
  const cookie = mods.session.issueSessionCookie(res.accountId);
  cookieJar.set(cookie.name, cookie.value);
  return res.accountId;
}

/** Единственный способ получить право — оплаченный заказ. */
function buy(mods: Loaded, accountId: number, steamId64: string, key: string): void {
  const order = mods.billing.createOrder({
    accountId,
    steamId64,
    amountKop: 19900,
    provider: "stub",
    idempotencyKey: key,
  });
  if (!order) throw new Error("заказ не создался");
  const result = mods.billing.markPaid(order.id, `provider-${key}`);
  if (result !== "granted") throw new Error(`право не выдалось: ${result}`);
}

let dbPath: string;

beforeEach(() => {
  cookieJar.clear();
  delete process.env.PAYWALL_MODE;
  process.env.ACCESS_SECRET = "test-secret-at-least-16-chars-long";
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "paywall-")), "identity.db");
});

afterEach(() => {
  delete process.env.PAYWALL_MODE;
  delete process.env.IDENTITY_DB_PATH;
  cookieJar.clear();
  vi.resetModules();
});

describe("переключатель режима", () => {
  it("не задан — касса выключена", async () => {
    const { access } = await load(dbPath);
    expect(access.paywallMode()).toBe("off");
  });

  it("мусорное значение — касса выключена, а не включена", async () => {
    // Опечатка в переменной окружения не должна начать брать деньги
    // и закрывать сайт. Неизвестное значение = off.
    const { access } = await load(dbPath);
    for (const junk of ["", "true", "on", "STUB", "yookassa", "1"]) {
      process.env.PAYWALL_MODE = junk;
      expect(access.paywallMode(), `значение ${JSON.stringify(junk)}`).toBe("off");
    }
  });

  it("узнаёт только два рабочих положения", async () => {
    const { access } = await load(dbPath);
    process.env.PAYWALL_MODE = "stub";
    expect(access.paywallMode()).toBe("stub");
    process.env.PAYWALL_MODE = "live";
    expect(access.paywallMode()).toBe("live");
  });
});

describe("проверка доступа при выключенной кассе", () => {
  it("открыто всем: сегодняшнее поведение сайта не меняется", async () => {
    const { access } = await load(dbPath);
    // Ни сессии, ни права, ни даже рабочей базы — и всё равно полный доступ:
    // платить негде, закрывать нечего.
    expect(await access.getAccessLevel(STEAM_ID)).toBe("full");
  });

  it("мусорный режим тоже оставляет сайт открытым", async () => {
    process.env.PAYWALL_MODE = "чепуха";
    const { access } = await load(dbPath);
    expect(await access.getAccessLevel(STEAM_ID)).toBe("full");
  });
});

describe("проверка доступа при включённой кассе", () => {
  it("без сессии доступа нет", async () => {
    process.env.PAYWALL_MODE = "stub";
    const mods = await load(dbPath);
    expect(await mods.access.getAccessLevel(STEAM_ID)).toBe("free");
  });

  it("сессия есть, права нет — доступа нет", async () => {
    process.env.PAYWALL_MODE = "stub";
    const mods = await load(dbPath);
    signIn(mods, "telegram-user-1");
    expect(await mods.access.getAccessLevel(STEAM_ID)).toBe("free");
  });

  it("сессия и право — полный доступ", async () => {
    process.env.PAYWALL_MODE = "stub";
    const mods = await load(dbPath);
    const accountId = signIn(mods, "telegram-user-1");
    buy(mods, accountId, STEAM_ID, "key-1");
    expect(await mods.access.getAccessLevel(STEAM_ID)).toBe("full");
  });

  it("право на один профиль не открывает другой", async () => {
    process.env.PAYWALL_MODE = "stub";
    const mods = await load(dbPath);
    const accountId = signIn(mods, "telegram-user-1");
    buy(mods, accountId, STEAM_ID, "key-1");
    expect(await mods.access.getAccessLevel(OTHER_STEAM_ID)).toBe("free");
  });

  it("чужая покупка не открывает разбор другому аккаунту", async () => {
    process.env.PAYWALL_MODE = "stub";
    const mods = await load(dbPath);
    const buyerId = signIn(mods, "telegram-buyer");
    buy(mods, buyerId, STEAM_ID, "key-1");

    // Вошёл кто-то другой — его сессия перетирает куку покупателя.
    signIn(mods, "telegram-stranger");
    expect(await mods.access.getAccessLevel(STEAM_ID)).toBe("free");
  });

  it("подделанная кука сессии доступа не даёт", async () => {
    process.env.PAYWALL_MODE = "stub";
    const mods = await load(dbPath);
    const accountId = signIn(mods, "telegram-user-1");
    buy(mods, accountId, STEAM_ID, "key-1");

    cookieJar.set("gt_session", `${accountId}.${Math.floor(Date.now() / 1000) + 3600}.${"0".repeat(64)}`);
    expect(await mods.access.getAccessLevel(STEAM_ID)).toBe("free");
  });

  it("недоступная база закрывает доступ, а не открывает", async () => {
    process.env.PAYWALL_MODE = "stub";

    // Сначала настоящая база: заводим аккаунт и выдаём право, чтобы кука
    // сессии была подлинной.
    const real = await load(dbPath);
    const accountId = signIn(real, "telegram-user-1");
    buy(real, accountId, STEAM_ID, "key-1");

    // Теперь база не открывается. Право прочитать невозможно — значит его нет.
    const broken = await load("/несуществующий-каталог-для-теста/identity.db");
    expect(await broken.access.getAccessLevel(STEAM_ID)).toBe("free");
  });

  it("сломанный секрет подписи закрывает доступ, а не открывает", async () => {
    process.env.PAYWALL_MODE = "stub";
    const mods = await load(dbPath);
    const accountId = signIn(mods, "telegram-user-1");
    buy(mods, accountId, STEAM_ID, "key-1");

    // Без секрета проверить подпись сессии нечем: это отказ, а не пропуск.
    delete process.env.ACCESS_SECRET;
    expect(await mods.access.getAccessLevel(STEAM_ID)).toBe("free");
  });
});
