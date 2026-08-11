import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { buildAggregatedProfile } from "@/lib/aggregation/aggregate";
import { portraitFixture, player, game, noBadges, noAchievements, noRecent } from "./fixtures";
import type { CardStats } from "@/lib/aggregation/aggregate";

/**
 * Последнее звено пути покупки: статус заказа для страницы возврата, маршрут
 * поддельной кассы и вечное хранение купленного.
 *
 * Устройство теста повторяет tests/pay-create.test.ts: своя база во временной
 * папке, `vi.resetModules()` на каждый мир и НАСТОЯЩАЯ подписанная кука сессии.
 * Подменять сессию нельзя — иначе спрятался бы ровно тот промах, ради которого
 * половина этих проверок написана: «маршрут отдаёт чужой заказ».
 *
 * Кеш подменён на карту, которая запоминает СРОК каждой записи: иначе «положено
 * навсегда» проверить нечем — настоящий кеш срок наружу не показывает.
 */
const cacheState = vi.hoisted(() => new Map<string, { value: unknown; ttl: number }>());

vi.mock("@/lib/cache/redis", () => ({
  getCache: async (key: string) => (cacheState.has(key) ? cacheState.get(key)!.value : null),
  setCache: async (key: string, value: unknown, ttl: number) => {
    cacheState.set(key, { value, ttl });
  },
  deleteCache: async (key: string) => {
    cacheState.delete(key);
  },
  incrementRateLimit: async () => 1,
}));

// Модель в этом тесте не нужна: проверяется срок хранения, а не текст.
const generatePortrait = vi.fn();
vi.mock("@/lib/llm/client", () => ({
  generatePortrait: (...args: unknown[]) => generatePortrait(...args),
}));

// Аналитика пишет в свой SQLite — в тесте ей делать нечего.
vi.mock("@/lib/analytics/db", () => ({
  logAnalysis: vi.fn(),
  logError: vi.fn(),
  getDb: () => null,
}));

const SECRET = "секрет-подписи-для-теста-подлиннее-тридцати-двух";
const ACCESS_SECRET = "секрет-сессии-для-теста";
const STEAM_ID = "76561197990915489";
const PRICE_KOP = 19900;

async function freshWorld(opts: { dbPath: string; mode?: string; secret?: string }) {
  process.env.IDENTITY_DB_PATH = opts.dbPath;
  process.env.ACCESS_SECRET = ACCESS_SECRET;
  setEnv("PAYWALL_MODE", opts.mode ?? "stub");
  setEnv("PAYMENT_WEBHOOK_SECRET", opts.secret ?? SECRET);

  vi.resetModules();
  const identity = await import("@/lib/identity/store");
  const billing = await import("@/lib/billing/store");
  const session = await import("@/lib/identity/session");
  const keys = await import("@/lib/cache/keys");
  const status = await import("@/app/api/pay/status/[orderId]/route");
  const stub = await import("@/app/api/pay/stub/[orderId]/route");
  const webhook = await import("@/app/api/pay/webhook/route");
  const generate = await import("@/app/api/generate/route");
  // Таблицы заводятся при первом обращении к базе.
  billing.billingAvailable();
  return { identity, billing, session, keys, status, stub, webhook, generate };
}

/** undefined означает «переменной нет вовсе», а не «пустая строка». */
function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

let dbPath: string;
let nextTelegramId = 1;

beforeEach(() => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pay-status-")), "billing.db");
  nextTelegramId = 1;
  cacheState.clear();
  generatePortrait.mockReset();
  generatePortrait.mockResolvedValue({
    portrait: portraitFixture(),
    provider: "openai",
    model: "test-model",
  });
});

afterEach(() => {
  delete process.env.IDENTITY_DB_PATH;
  delete process.env.ACCESS_SECRET;
  delete process.env.PAYWALL_MODE;
  delete process.env.PAYMENT_WEBHOOK_SECRET;
  vi.resetModules();
});

type World = Awaited<ReturnType<typeof freshWorld>>;

function makeAccount(identity: World["identity"]): number {
  const res = identity.loginOrCreate("telegram", `tg-${nextTelegramId++}`);
  if (res.status !== "ok") throw new Error("не удалось завести тестовый аккаунт");
  return res.accountId;
}

/** Настоящая подписанная кука сессии — та же, что выдаёт вход. */
function cookieFor(session: World["session"], accountId: number): string {
  const cookie = session.issueSessionCookie(accountId);
  return `${cookie.name}=${cookie.value}`;
}

function makeOrder(billing: World["billing"], accountId: number, key: string, steamId = STEAM_ID) {
  const created = billing.createOrder({
    accountId,
    steamId64: steamId,
    amountKop: PRICE_KOP,
    provider: "stub",
    idempotencyKey: key,
  });
  if (!created) throw new Error("не удалось завести тестовый заказ");
  return created.id;
}

/** Второй аргумент маршрута: в Next 15+ параметры пути приходят промисом. */
function ctx(orderId: number | string) {
  return { params: Promise.resolve({ orderId: String(orderId) }) };
}

function statusRequest(cookie?: string): Request {
  const headers: Record<string, string> = {};
  if (cookie) headers["cookie"] = cookie;
  return new Request("https://example.test/api/pay/status/1", { headers });
}

function stubRequest(outcome: unknown, cookie?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cookie) headers["cookie"] = cookie;
  return new Request("https://example.test/api/pay/stub/1", {
    method: "POST",
    body: JSON.stringify({ outcome }),
    headers,
  });
}

/**
 * Генеральная репетиция: браузер получает от маршрута поддельной кассы готовое
 * тело с подписью и шлёт их в вебхук ровно так, как это делает страница оплаты.
 * Тело пересобирать нельзя — подпись считается по байтам.
 */
async function payThroughStub(
  world: World,
  orderId: number,
  cookie: string,
  outcome: "paid" | "declined",
): Promise<{ prepared: Response; hook: Response }> {
  const prepared = await world.stub.POST(stubRequest(outcome, cookie), ctx(orderId));
  if (!prepared.ok) return { prepared, hook: prepared };

  const { body, signature, header } = (await prepared.json()) as {
    body: string;
    signature: string;
    header: string;
  };
  const hook = await world.webhook.POST(
    new Request("https://example.test/api/pay/webhook", {
      method: "POST",
      body,
      headers: { "content-type": "application/json", [header]: signature },
    }),
  );
  return { prepared, hook };
}

describe("статус заказа для страницы возврата", () => {
  it("только что созданный заказ — created", async () => {
    const world = await freshWorld({ dbPath });
    const accountId = makeAccount(world.identity);
    const orderId = makeOrder(world.billing, accountId, "status-created");

    const res = await world.status.GET(
      statusRequest(cookieFor(world.session, accountId)),
      ctx(orderId),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("created");
    expect(body.steamId64).toBe(STEAM_ID);
  });

  it("после подтверждения оплаты — paid", async () => {
    const world = await freshWorld({ dbPath });
    const accountId = makeAccount(world.identity);
    const orderId = makeOrder(world.billing, accountId, "status-paid");
    expect(world.billing.markPaid(orderId, `stub-${orderId}`)).toBe("granted");

    const res = await world.status.GET(
      statusRequest(cookieFor(world.session, accountId)),
      ctx(orderId),
    );

    expect((await res.json()).status).toBe("paid");
  });

  it("наружу не уезжает ничего лишнего: ни суммы, ни ключа идемпотентности", async () => {
    const world = await freshWorld({ dbPath });
    const accountId = makeAccount(world.identity);
    const orderId = makeOrder(world.billing, accountId, "status-lean");

    const res = await world.status.GET(
      statusRequest(cookieFor(world.session, accountId)),
      ctx(orderId),
    );

    expect(Object.keys(await res.json()).sort()).toEqual(["status", "steamId64"]);
  });

  it("чужой заказ — 404, без входа — 401", async () => {
    const world = await freshWorld({ dbPath });
    const owner = makeAccount(world.identity);
    const stranger = makeAccount(world.identity);
    const orderId = makeOrder(world.billing, owner, "status-foreign");

    const foreign = await world.status.GET(
      statusRequest(cookieFor(world.session, stranger)),
      ctx(orderId),
    );
    const anonymous = await world.status.GET(statusRequest(), ctx(orderId));
    // Несуществующий заказ отвечает тем же кодом, что и чужой: иначе по кодам
    // ответа можно перебрать чужие номера.
    const missing = await world.status.GET(
      statusRequest(cookieFor(world.session, stranger)),
      ctx(999999),
    );

    expect(foreign.status).toBe(404);
    expect(anonymous.status).toBe(401);
    expect(missing.status).toBe(404);
  });
});

describe("генеральная репетиция: поддельная касса и вебхук", () => {
  it("исход paid проходит весь путь и выдаёт право", async () => {
    const world = await freshWorld({ dbPath });
    const accountId = makeAccount(world.identity);
    const cookie = cookieFor(world.session, accountId);
    const orderId = makeOrder(world.billing, accountId, "stub-paid");

    const { prepared, hook } = await payThroughStub(world, orderId, cookie, "paid");

    expect(prepared.status).toBe(200);
    expect(hook.status).toBe(200);
    expect(world.billing.findOrder(orderId)!.status).toBe("paid");
    expect(world.billing.hasEntitlement(accountId, STEAM_ID)).toBe(true);

    const status = await world.status.GET(statusRequest(cookie), ctx(orderId));
    expect((await status.json()).status).toBe("paid");
  });

  it("исход declined отменяет заказ и права не даёт", async () => {
    const world = await freshWorld({ dbPath });
    const accountId = makeAccount(world.identity);
    const cookie = cookieFor(world.session, accountId);
    const orderId = makeOrder(world.billing, accountId, "stub-declined");

    const { hook } = await payThroughStub(world, orderId, cookie, "declined");

    expect(hook.status).toBe(200);
    expect(world.billing.findOrder(orderId)!.status).toBe("cancelled");
    expect(world.billing.hasEntitlement(accountId, STEAM_ID)).toBe(false);
  });

  it("сумму и номер заказа браузер задать не может — они берутся из заказа", async () => {
    const world = await freshWorld({ dbPath });
    const accountId = makeAccount(world.identity);
    const cookie = cookieFor(world.session, accountId);
    const orderId = makeOrder(world.billing, accountId, "stub-body");

    const res = await world.stub.POST(
      new Request("https://example.test/api/pay/stub/1", {
        method: "POST",
        // Попытка подсунуть свою сумму и чужой номер заказа.
        body: JSON.stringify({ outcome: "paid", amountKop: 1, orderId: 999999 }),
        headers: { "content-type": "application/json", cookie },
      }),
      ctx(orderId),
    );
    const payload = JSON.parse((await res.json()).body);

    expect(payload).toMatchObject({
      orderId,
      amountKop: PRICE_KOP,
      currency: "RUB",
      outcome: "paid",
      providerOrderId: `stub-${orderId}`,
    });
  });

  it("чужой заказ через поддельную кассу оплатить нельзя", async () => {
    const world = await freshWorld({ dbPath });
    const owner = makeAccount(world.identity);
    const stranger = makeAccount(world.identity);
    const orderId = makeOrder(world.billing, owner, "stub-foreign");

    const res = await world.stub.POST(
      stubRequest("paid", cookieFor(world.session, stranger)),
      ctx(orderId),
    );

    expect(res.status).toBe(404);
    expect(world.billing.findOrder(orderId)!.status).toBe("created");
  });

  it("исход, которого не бывает, подтверждения не готовит", async () => {
    const world = await freshWorld({ dbPath });
    const accountId = makeAccount(world.identity);
    const cookie = cookieFor(world.session, accountId);
    const orderId = makeOrder(world.billing, accountId, "stub-outcome");

    for (const outcome of ["", "PAID", "maybe", 1, null]) {
      const res = await world.stub.POST(stubRequest(outcome, cookie), ctx(orderId));
      expect(res.status).toBe(400);
    }
    expect(world.billing.findOrder(orderId)!.status).toBe("created");
  });

  it("при PAYWALL_MODE=off поддельной кассы не существует — 404", async () => {
    const world = await freshWorld({ dbPath, mode: "off" });
    const accountId = makeAccount(world.identity);
    const orderId = makeOrder(world.billing, accountId, "stub-off");

    const res = await world.stub.POST(
      stubRequest("paid", cookieFor(world.session, accountId)),
      ctx(orderId),
    );

    expect(res.status).toBe(404);
    expect(world.billing.findOrder(orderId)!.status).toBe("created");
  });
});

describe("купленное хранится долго, а не сутки", () => {
  const cardStats: CardStats = {
    dedication: 91,
    mastery: 42,
    exploration: 17,
    hoarding: 88,
    social: 3,
    veteran: 64,
  };

  const profile = buildAggregatedProfile(
    player(),
    [game({ name: "Test Game" })],
    noRecent,
    10,
    [],
    noBadges,
    noAchievements,
  );

  /** Кладёт разобранный профиль и карточку так, как их кладёт обычный разбор. */
  function fillCache(keys: World["keys"], opts: { portrait: boolean }): void {
    const ttl = keys.CACHE_TTL.aggregatedProfile;
    cacheState.set(keys.profileKey(STEAM_ID), { value: profile, ttl });
    cacheState.set(keys.cardStatsKey(STEAM_ID), { value: cardStats, ttl });
    cacheState.set(keys.rarityKey(STEAM_ID), { value: "legendary", ttl });
    if (opts.portrait) {
      cacheState.set(keys.portraitKey(STEAM_ID, "ru"), {
        value: portraitFixture(),
        ttl: keys.CACHE_TTL.portrait,
      });
    }
  }

  it("после выдачи права разбор перекладывается надолго", async () => {
    const world = await freshWorld({ dbPath });
    const accountId = makeAccount(world.identity);
    const cookie = cookieFor(world.session, accountId);
    const orderId = makeOrder(world.billing, accountId, "keep-after-webhook");
    fillCache(world.keys, { portrait: true });

    const { hook } = await payThroughStub(world, orderId, cookie, "paid");

    expect(hook.status).toBe(200);
    // К моменту покупки карточка УЖЕ лежит с суточным сроком, и генерации
    // больше не будет: не переложить её здесь — значит через сутки отдать
    // покупателю «данные устарели» за его же деньги.
    const long = world.keys.CACHE_TTL.purchased;
    expect(cacheState.get(world.keys.portraitKey(STEAM_ID, "ru"))!.ttl).toBe(long);
    expect(cacheState.get(world.keys.profileKey(STEAM_ID))!.ttl).toBe(long);
    expect(cacheState.get(world.keys.cardStatsKey(STEAM_ID))!.ttl).toBe(long);
    expect(cacheState.get(world.keys.rarityKey(STEAM_ID))!.ttl).toBe(long);
  });

  it("чего в кеше нет, то молча пропускается — вебхук всё равно 200", async () => {
    const world = await freshWorld({ dbPath });
    const accountId = makeAccount(world.identity);
    const cookie = cookieFor(world.session, accountId);
    const orderId = makeOrder(world.billing, accountId, "keep-empty-cache");

    // Кеш пуст целиком: право важнее кеша, и неудачный ответ заставил бы кассу
    // слать подтверждение снова.
    const { hook } = await payThroughStub(world, orderId, cookie, "paid");

    expect(hook.status).toBe(200);
    expect(world.billing.hasEntitlement(accountId, STEAM_ID)).toBe(true);
    expect(cacheState.has(world.keys.portraitKey(STEAM_ID, "ru"))).toBe(false);
  });

  it("генерация при существующем праве кладёт портрет надолго", async () => {
    const world = await freshWorld({ dbPath });
    const accountId = makeAccount(world.identity);
    const orderId = makeOrder(world.billing, accountId, "keep-on-generate");
    expect(world.billing.markPaid(orderId, `stub-${orderId}`)).toBe("granted");
    // Портрета нет: покупатель вернулся, когда карточка уже истекла, и разбор
    // запустился заново.
    fillCache(world.keys, { portrait: false });

    const res = await world.generate.POST(
      new Request("https://example.test/api/generate", {
        method: "POST",
        body: JSON.stringify({ steamId64: STEAM_ID, locale: "ru" }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(res.status).toBe(200);
    expect(cacheState.get(world.keys.portraitKey(STEAM_ID, "ru"))!.ttl).toBe(
      world.keys.CACHE_TTL.purchased,
    );
  });

  it("а без права — по-прежнему суточный срок", async () => {
    const world = await freshWorld({ dbPath });
    makeAccount(world.identity);
    fillCache(world.keys, { portrait: false });

    const res = await world.generate.POST(
      new Request("https://example.test/api/generate", {
        method: "POST",
        body: JSON.stringify({ steamId64: STEAM_ID, locale: "ru" }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(res.status).toBe(200);
    expect(cacheState.get(world.keys.portraitKey(STEAM_ID, "ru"))!.ttl).toBe(
      world.keys.CACHE_TTL.portrait,
    );
  });

  it("право ЛЮБОГО аккаунта на этот разбор считается за купленное", async () => {
    const world = await freshWorld({ dbPath });
    const buyer = makeAccount(world.identity);
    makeAccount(world.identity);
    const orderId = makeOrder(world.billing, buyer, "keep-any-account");
    expect(world.billing.markPaid(orderId, `stub-${orderId}`)).toBe("granted");

    // Разбор один на всех: кто бы его ни купил, портрет обязан пережить сутки.
    expect(world.billing.steamIdHasEntitlement(STEAM_ID)).toBe(true);
    expect(world.billing.steamIdHasEntitlement("76561197990915488")).toBe(false);
  });
});
