import Database from "better-sqlite3";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * Как в tests/billing-store.test.ts: соединение с базой кешируется в модуле,
 * поэтому каждому тесту нужна своя база И свежий импорт всех модулей. Заодно
 * поднимаем identity-store — orders.account_id ссылается на реальную строку
 * accounts (внешний ключ), выдуманный id не пройдёт.
 */
async function freshWorld(opts: { dbPath: string; mode?: string; secret?: string }) {
  process.env.IDENTITY_DB_PATH = opts.dbPath;
  setEnv("PAYWALL_MODE", opts.mode);
  setEnv("PAYMENT_WEBHOOK_SECRET", opts.secret);

  vi.resetModules();
  const identity = await import("@/lib/identity/store");
  const billing = await import("@/lib/billing/store");
  const stub = await import("@/lib/billing/stub-provider");
  const route = await import("@/app/api/pay/webhook/route");
  return { identity, billing, stub, route };
}

/** undefined означает «переменной нет вовсе», а не «пустая строка». */
function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

/** Не короче 32 знаков: коротким секретам маршрут не доверяет. */
const SECRET = "секрет-подписи-для-теста-подлиннее-тридцати-двух";
const STEAM_ID = "76561197990915489";
const PRICE_KOP = 19900;

let dbPath: string;
let nextTelegramId = 1;

beforeEach(() => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pay-webhook-")), "billing.db");
  nextTelegramId = 1;
});

afterEach(() => {
  delete process.env.IDENTITY_DB_PATH;
  delete process.env.PAYWALL_MODE;
  delete process.env.PAYMENT_WEBHOOK_SECRET;
  delete process.env.PAYWALL_ALLOW_STUB_IN_PROD;
  vi.unstubAllEnvs();
  vi.resetModules();
});

function makeAccount(identity: Awaited<ReturnType<typeof freshWorld>>["identity"]): number {
  const res = identity.loginOrCreate("telegram", `tg-${nextTelegramId++}`);
  if (res.status !== "ok") throw new Error("не удалось завести тестовый аккаунт");
  return res.accountId;
}

/** Считает права напрямую в базе — независимая проверка, мимо store. */
function countEntitlements(): number {
  const raw = new Database(dbPath);
  try {
    const row = raw.prepare("SELECT COUNT(*) AS n FROM entitlements").get() as { n: number };
    return row.n;
  } finally {
    raw.close();
  }
}

function webhookRequest(rawBody: string, signature: string | null): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signature !== null) headers["x-payment-signature"] = signature;
  return new Request("https://example.test/api/pay/webhook", {
    method: "POST",
    body: rawBody,
    headers,
  });
}

/**
 * Тело подтверждения ровно в том виде, в каком его шлёт поддельная касса.
 * Исход, сумма и валюта — часть подписанного тела: маршрут обязан сверять
 * уплаченное с заказанным, а не верить факту прихода подтверждения.
 */
function confirmBody(
  orderId: number,
  over: Partial<{ outcome: string; amountKop: number; currency: string; providerOrderId: string }> = {},
): string {
  return JSON.stringify({
    orderId,
    providerOrderId: `stub-${orderId}`,
    outcome: "paid",
    amountKop: PRICE_KOP,
    currency: "RUB",
    ...over,
  });
}

describe("вебхук оплаты", () => {
  it("верная подпись переводит заказ в оплаченный и выдаёт право", async () => {
    const { identity, billing, stub, route } = await freshWorld({ dbPath, mode: "stub", secret: SECRET });
    const accountId = makeAccount(identity);
    const order = billing.createOrder({
      accountId,
      steamId64: STEAM_ID,
      amountKop: 19900,
      provider: "stub",
      idempotencyKey: "webhook-ok",
    });
    const body = confirmBody(order!.id);

    const res = await route.POST(webhookRequest(body, stub.signStubWebhook(body)));

    expect(res.status).toBe(200);
    expect(billing.findOrder(order!.id)!.status).toBe("paid");
    expect(billing.hasEntitlement(accountId, STEAM_ID)).toBe(true);
    expect(countEntitlements()).toBe(1);
  });

  it("тот же вебхук второй раз — снова 200, но право одно и заказ не оплачен дважды", async () => {
    const { identity, billing, stub, route } = await freshWorld({ dbPath, mode: "stub", secret: SECRET });
    const accountId = makeAccount(identity);
    const order = billing.createOrder({
      accountId,
      steamId64: STEAM_ID,
      amountKop: 19900,
      provider: "stub",
      idempotencyKey: "webhook-twice",
    });
    const body = confirmBody(order!.id);
    const signature = stub.signStubWebhook(body);

    const first = await route.POST(webhookRequest(body, signature));
    const afterFirst = billing.findOrder(order!.id)!;
    const second = await route.POST(webhookRequest(body, signature));
    const afterSecond = billing.findOrder(order!.id)!;

    // Кассы шлют подтверждение по два штатно: второй раз обязан быть тихим
    // успехом, иначе касса будет ретраить бесконечно.
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(countEntitlements()).toBe(1);
    expect(billing.hasEntitlement(accountId, STEAM_ID)).toBe(true);
    // «Не оплачен дважды»: отметка времени оплаты не переписана вторым вызовом.
    expect(afterSecond.paidAt).toBe(afterFirst.paidAt);
    expect(afterSecond.status).toBe("paid");
  });

  it("неверная подпись — 401, права нет", async () => {
    const { identity, billing, route } = await freshWorld({ dbPath, mode: "stub", secret: SECRET });
    const accountId = makeAccount(identity);
    const order = billing.createOrder({
      accountId,
      steamId64: STEAM_ID,
      amountKop: 19900,
      provider: "stub",
      idempotencyKey: "webhook-bad-sig",
    });
    const body = confirmBody(order!.id);

    // Заведомо не подпись и не той длины — отсеивается сравнением длины.
    const res = await route.POST(webhookRequest(body, "deadbeef"));

    expect(res.status).toBe(401);
    expect(billing.findOrder(order!.id)!.status).toBe("created");
    expect(billing.hasEntitlement(accountId, STEAM_ID)).toBe(false);
    expect(countEntitlements()).toBe(0);
  });

  it("подпись верной длины, но неверная по содержимому — 401", async () => {
    const { identity, billing, stub, route } = await freshWorld({ dbPath, mode: "stub", secret: SECRET });
    const accountId = makeAccount(identity);
    const order = billing.createOrder({
      accountId,
      steamId64: STEAM_ID,
      amountKop: 19900,
      provider: "stub",
      idempotencyKey: "webhook-same-length",
    });
    const body = confirmBody(order!.id);
    const real = stub.signStubWebhook(body);
    // Ровно та же длина, отличается одним знаком: проверка длины такую подпись
    // не отсеет, отказать обязано сравнение содержимого.
    const forged = (real[0] === "a" ? "b" : "a") + real.slice(1);
    expect(forged).toHaveLength(real.length);
    expect(forged).not.toBe(real);

    const res = await route.POST(webhookRequest(body, forged));

    expect(res.status).toBe(401);
    expect(billing.findOrder(order!.id)!.status).toBe("created");
    expect(billing.hasEntitlement(accountId, STEAM_ID)).toBe(false);
  });

  it("верная подпись от ЧУЖОГО тела не открывает подмену тела — 401", async () => {
    const { identity, billing, stub, route } = await freshWorld({ dbPath, mode: "stub", secret: SECRET });
    const accountId = makeAccount(identity);
    const mine = billing.createOrder({
      accountId,
      steamId64: STEAM_ID,
      amountKop: 19900,
      provider: "stub",
      idempotencyKey: "webhook-mine",
    });
    const victim = billing.createOrder({
      accountId,
      steamId64: "11111111111111111",
      amountKop: 19900,
      provider: "stub",
      idempotencyKey: "webhook-victim",
    });

    // Подпись честная, но снята с другого тела: подпись обязана быть привязана
    // к байтам ЭТОГО запроса, а не быть просто «валидной строкой».
    const res = await route.POST(
      webhookRequest(confirmBody(victim!.id), stub.signStubWebhook(confirmBody(mine!.id))),
    );

    expect(res.status).toBe(401);
    expect(billing.findOrder(victim!.id)!.status).toBe("created");
    expect(countEntitlements()).toBe(0);
  });

  it("без заголовка подписи — 401", async () => {
    const { identity, billing, route } = await freshWorld({ dbPath, mode: "stub", secret: SECRET });
    const accountId = makeAccount(identity);
    const order = billing.createOrder({
      accountId,
      steamId64: STEAM_ID,
      amountKop: 19900,
      provider: "stub",
      idempotencyKey: "webhook-no-sig",
    });

    const res = await route.POST(webhookRequest(confirmBody(order!.id), null));

    expect(res.status).toBe(401);
    expect(billing.findOrder(order!.id)!.status).toBe("created");
    expect(billing.hasEntitlement(accountId, STEAM_ID)).toBe(false);
  });

  it("вебхук на несуществующий заказ — 404, ничего не выдаётся", async () => {
    const { stub, route } = await freshWorld({ dbPath, mode: "stub", secret: SECRET });
    const body = confirmBody(999999);

    const res = await route.POST(webhookRequest(body, stub.signStubWebhook(body)));

    expect(res.status).toBe(404);
    expect(countEntitlements()).toBe(0);
  });
});

describe("нет секрета — приёмщик не стартует", () => {
  /**
   * В этом проекте условие «если секрет задан» уже однажды открыло
   * телеграм-вебхук всему миру: при пустой переменной он принимал что угодно.
   * Поэтому пустой секрет обязан закрывать маршрут целиком, а не пропускать
   * запросы «без подписи, значит и проверять нечего».
   */
  it("пустой PAYMENT_WEBHOOK_SECRET — 503 и на подписанный запрос, и на запрос без подписи", async () => {
    const { identity, billing, route } = await freshWorld({ dbPath, mode: "stub", secret: "" });
    const accountId = makeAccount(identity);
    const order = billing.createOrder({
      accountId,
      steamId64: STEAM_ID,
      amountKop: 19900,
      provider: "stub",
      idempotencyKey: "webhook-no-secret",
    });
    const body = confirmBody(order!.id);

    const unsigned = await route.POST(webhookRequest(body, null));
    const signed = await route.POST(webhookRequest(body, "a".repeat(64)));

    expect(unsigned.status).toBe(503);
    expect(signed.status).toBe(503);
    expect(billing.findOrder(order!.id)!.status).toBe("created");
    expect(countEntitlements()).toBe(0);
  });

  it("переменной нет вовсе — тоже 503", async () => {
    const { route } = await freshWorld({ dbPath, mode: "stub", secret: undefined });

    const res = await route.POST(webhookRequest(confirmBody(1), "a".repeat(64)));

    expect(res.status).toBe(503);
  });

  it("короткий секрет не принимается — 503", async () => {
    // Секрет — единственное, что стоит между чужим человеком и бесплатным
    // правом, а подбирают его локально: в сеть уходит один запрос на удачного
    // кандидата. Короткий секрет — это отсутствие секрета, только незаметное.
    const { identity, billing, stub, route } = await freshWorld({ dbPath, mode: "stub", secret: "коротко" });
    const accountId = makeAccount(identity);
    const order = billing.createOrder({
      accountId,
      steamId64: STEAM_ID,
      amountKop: PRICE_KOP,
      provider: "stub",
      idempotencyKey: "webhook-short-secret",
    });
    const body = confirmBody(order!.id);

    // Подпись честная — секрет тот же самый. Отказать должна именно его длина.
    const res = await route.POST(webhookRequest(body, stub.signStubWebhook(body)));

    expect(res.status).toBe(503);
    expect(billing.findOrder(order!.id)!.status).toBe("created");
    expect(countEntitlements()).toBe(0);
  });

  it("секрет ровно в 32 знака уже годится", async () => {
    const { identity, billing, stub, route } = await freshWorld({
      dbPath,
      mode: "stub",
      secret: "a".repeat(32),
    });
    const accountId = makeAccount(identity);
    const order = billing.createOrder({
      accountId,
      steamId64: STEAM_ID,
      amountKop: PRICE_KOP,
      provider: "stub",
      idempotencyKey: "webhook-border-secret",
    });
    const body = confirmBody(order!.id);

    const res = await route.POST(webhookRequest(body, stub.signStubWebhook(body)));

    expect(res.status).toBe(200);
  });
});

describe("исход платежа и сверка суммы", () => {
  /** Заводит аккаунт и заказ на 19900 копеек, возвращает всё нужное тесту. */
  async function orderedWorld(key: string) {
    const world = await freshWorld({ dbPath, mode: "stub", secret: SECRET });
    const accountId = makeAccount(world.identity);
    const order = world.billing.createOrder({
      accountId,
      steamId64: STEAM_ID,
      amountKop: PRICE_KOP,
      provider: "stub",
      idempotencyKey: key,
    });
    return { ...world, accountId, orderId: order!.id };
  }

  async function send(world: Awaited<ReturnType<typeof orderedWorld>>, body: string) {
    return world.route.POST(webhookRequest(body, world.stub.signStubWebhook(body)));
  }

  it("исход «не оплачено» отменяет заказ и не выдаёт права", async () => {
    const world = await orderedWorld("webhook-declined");

    const res = await send(world, confirmBody(world.orderId, { outcome: "declined" }));

    // 200: касса своё дело сделала и ретраить ей нечего. Но заказ закрыт
    // отказом, а права нет.
    expect(res.status).toBe(200);
    expect(world.billing.findOrder(world.orderId)!.status).toBe("cancelled");
    expect(world.billing.hasEntitlement(world.accountId, STEAM_ID)).toBe(false);
    expect(countEntitlements()).toBe(0);
  });

  it("повторный отказ по тому же заказу — снова 200 и ничего не ломает", async () => {
    const world = await orderedWorld("webhook-declined-twice");
    const body = confirmBody(world.orderId, { outcome: "declined" });

    const first = await send(world, body);
    const second = await send(world, body);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(world.billing.findOrder(world.orderId)!.status).toBe("cancelled");
    expect(countEntitlements()).toBe(0);
  });

  it("сумма меньше заказанной права не выдаёт", async () => {
    const world = await orderedWorld("webhook-underpaid");

    // Подпись честная: тело написано тем, у кого есть секрет. Но заплачена
    // одна копейка вместо 199 рублей — сверять сумму обязан маршрут.
    const res = await send(world, confirmBody(world.orderId, { amountKop: 1 }));

    expect(res.status).toBe(409);
    expect(world.billing.findOrder(world.orderId)!.status).toBe("created");
    expect(world.billing.hasEntitlement(world.accountId, STEAM_ID)).toBe(false);
    expect(countEntitlements()).toBe(0);
  });

  it("другая валюта права не выдаёт", async () => {
    const world = await orderedWorld("webhook-wrong-currency");

    // 19900 тугриков — не 19900 копеек.
    const res = await send(world, confirmBody(world.orderId, { currency: "MNT" }));

    expect(res.status).toBe(409);
    expect(world.billing.findOrder(world.orderId)!.status).toBe("created");
    expect(countEntitlements()).toBe(0);
  });

  it("переплата права тоже не выдаёт автоматом", async () => {
    const world = await orderedWorld("webhook-overpaid");

    // Сумма обязана СОВПАДАТЬ: «больше» — такое же расхождение, как «меньше»,
    // и разбирать его должен человек, а не маршрут.
    const res = await send(world, confirmBody(world.orderId, { amountKop: PRICE_KOP + 1 }));

    expect(res.status).toBe(409);
    expect(countEntitlements()).toBe(0);
  });

  it("неизвестный исход не считается оплатой", async () => {
    const world = await orderedWorld("webhook-unknown-outcome");

    const res = await send(world, confirmBody(world.orderId, { outcome: "maybe" }));

    expect(res.status).toBe(401);
    expect(world.billing.findOrder(world.orderId)!.status).toBe("created");
    expect(countEntitlements()).toBe(0);
  });

  it("оплата по уже отменённому заказу не выдаёт права и кричит в лог", async () => {
    const world = await orderedWorld("webhook-paid-after-cancel");
    const complain = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await send(world, confirmBody(world.orderId, { outcome: "declined" }));
      complain.mockClear();

      const res = await send(world, confirmBody(world.orderId));

      // Касса думает, что всё хорошо, а покупатель ничего не получил — такое
      // расхождение обязано быть видно человеку, а не тонуть в тишине.
      expect(res.status).toBe(409);
      expect(complain).toHaveBeenCalled();
      expect(world.billing.findOrder(world.orderId)!.status).toBe("cancelled");
      expect(countEntitlements()).toBe(0);
    } finally {
      complain.mockRestore();
    }
  });

  it("отказ по уже оплаченному заказу оплату не отбирает", async () => {
    const world = await orderedWorld("webhook-cancel-after-paid");
    await send(world, confirmBody(world.orderId));

    const res = await send(world, confirmBody(world.orderId, { outcome: "declined" }));

    expect(res.status).toBe(409);
    expect(world.billing.findOrder(world.orderId)!.status).toBe("paid");
    expect(world.billing.hasEntitlement(world.accountId, STEAM_ID)).toBe(true);
  });
});

describe("недоступная база не должна выглядеть как «нет такого заказа»", () => {
  /** Каталога не существует — база не откроется никогда, а не разово. */
  const brokenPath = "/nonexistent-dir-для-теста/billing.db";

  it("вебхук отвечает 5xx, а не 404", async () => {
    const { stub, route } = await freshWorld({ dbPath: brokenPath, mode: "stub", secret: SECRET });
    const body = confirmBody(1);

    const res = await route.POST(webhookRequest(body, stub.signStubWebhook(body)));

    // 404 касса считает окончательным ответом и ретраить перестаёт: деньги
    // взяты, право потеряно навсегда. Состояние это стойкое — неоткрываемый
    // файл базы или упавшая миграция, — поэтому так пропали бы ВСЕ оплаты.
    expect(res.status).toBeGreaterThanOrEqual(500);
  });
});

describe("выбор приёмщика по PAYWALL_MODE", () => {
  async function provider(mode: string | undefined) {
    setEnv("PAYWALL_MODE", mode);
    process.env.PAYMENT_WEBHOOK_SECRET = SECRET;
    vi.resetModules();
    const { getProvider } = await import("@/lib/billing/provider");
    return getProvider();
  }

  it("stub даёт поддельную кассу", async () => {
    expect((await provider("stub"))?.name).toBe("stub");
  });

  it("off, отсутствие переменной и мусорное значение кассу не открывают", async () => {
    expect(await provider("off")).toBeNull();
    expect(await provider(undefined)).toBeNull();
    // Опечатка в переменной не должна означать «включить поддельную кассу».
    expect(await provider("STUB ")).toBeNull();
    expect(await provider("да")).toBeNull();
  });

  it("live пока не подключён — null, а не молчаливая заглушка", async () => {
    expect(await provider("live")).toBeNull();
  });

  it("в боевом окружении заглушка не стартует без явного разрешения", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(await provider("stub")).toBeNull();

    process.env.PAYWALL_ALLOW_STUB_IN_PROD = "true";
    expect((await provider("stub"))?.name).toBe("stub");
  });

  it("при выключенной кассе вебхук ничего не принимает", async () => {
    const { billing, identity, stub } = await freshWorld({ dbPath, mode: "stub", secret: SECRET });
    const accountId = makeAccount(identity);
    const order = billing.createOrder({
      accountId,
      steamId64: STEAM_ID,
      amountKop: 19900,
      provider: "stub",
      idempotencyKey: "webhook-mode-off",
    });
    const body = confirmBody(order!.id);
    const signature = stub.signStubWebhook(body);

    // Тот же самый запрос, что выше проходил, — но касса выключена.
    process.env.PAYWALL_MODE = "off";
    vi.resetModules();
    const offRoute = await import("@/app/api/pay/webhook/route");
    const res = await offRoute.POST(webhookRequest(body, signature));

    expect(res.status).toBe(503);
    expect(countEntitlements()).toBe(0);
  });
});

describe("поддельная касса", () => {
  it("createPayment ведёт на свою страницу оплаты и помечает заказ", async () => {
    const { stub } = await freshWorld({ dbPath, mode: "stub", secret: SECRET });
    const provider = stub.getStubProvider();

    const payment = await provider!.createPayment({ orderId: 42, amountKop: 19900, locale: "ru" });

    expect(payment.payUrl).toBe("/ru/pay/42");
    expect(payment.providerOrderId).toBe("stub-42");
  });

  it("без годного секрета касса не стартует вовсе, а не отказывает на последнем клике", async () => {
    // Иначе владелец ставит секрет в 16 знаков — и всё выглядит рабочим:
    // витрина рисуется, заказ создаётся, касса открывается, сумма показана.
    // Отказ приходит только на «Оплатить», человеку с этого экрана уже некуда
    // идти, а первая внятная строка в логе появляется после того, как он упёрся.
    const short = await freshWorld({ dbPath, mode: "stub", secret: "коротко" });
    expect(short.stub.getStubProvider()).toBeNull();

    const none = await freshWorld({ dbPath, mode: "stub", secret: undefined });
    expect(none.stub.getStubProvider()).toBeNull();

    // А с годным секретом — стартует: отказывает именно длина.
    const ok = await freshWorld({ dbPath, mode: "stub", secret: SECRET });
    expect(ok.stub.getStubProvider()?.name).toBe("stub");
  });

  it("при PAYWALL_MODE=off заглушку нельзя получить и напрямую из фабрики", async () => {
    // Витрина и касса — одно значение, а не два независимых флага: код задач
    // 5 и 6, импортирующий заглушку напрямую, не должен уметь провести
    // покупку при выключенном PAYWALL_MODE в обход getProvider().
    const { stub } = await freshWorld({ dbPath, mode: "off", secret: SECRET });

    expect(stub.getStubProvider()).toBeNull();
  });

  it("verifyWebhook отказывает на теле, которое не разбирается в заказ", async () => {
    const { stub } = await freshWorld({ dbPath, mode: "stub", secret: SECRET });
    const provider = stub.getStubProvider()!;

    // Подпись честная — беда в содержимом. Мусорное тело не должно
    // превращаться в заказ №NaN.
    for (const body of ["не json", "{}", '{"orderId":"12"}', '{"orderId":12}', "[]"]) {
      expect(provider.verifyWebhook(body, stub.signStubWebhook(body))).toBeNull();
    }
  });
});
