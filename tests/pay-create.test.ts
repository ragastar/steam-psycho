import Database from "better-sqlite3";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * Как в tests/pay-webhook.test.ts: соединение с базой кешируется в модуле,
 * поэтому каждому тесту нужна своя база И свежий импорт всех модулей. Заодно
 * поднимаем identity-store — orders.account_id ссылается на настоящую строку
 * accounts (внешний ключ), выдуманный id не пройдёт.
 *
 * Сессию НЕ подменяем: маршрут читает ту же подписанную куку, что и весь
 * остальной вход, и тест подписывает её настоящим issueSessionCookie. Подмена
 * модуля сессии скрыла бы ровно ту ошибку, ради которой этот тест написан, —
 * «маршрут пускает без входа».
 */
async function freshWorld(opts: {
  dbPath: string;
  mode?: string;
  secret?: string;
  /** Потолок попыток начать покупку. По умолчанию заведомо недостижимый. */
  rateLimit?: string;
}) {
  process.env.IDENTITY_DB_PATH = opts.dbPath;
  process.env.ACCESS_SECRET = ACCESS_SECRET;
  setEnv("PAYWALL_MODE", opts.mode);
  setEnv("PAYMENT_WEBHOOK_SECRET", opts.secret ?? SECRET);
  setEnv("PAY_RATE_LIMIT_PER_HOUR", opts.rateLimit ?? "1000");

  vi.resetModules();
  const identity = await import("@/lib/identity/store");
  const billing = await import("@/lib/billing/store");
  const session = await import("@/lib/identity/session");
  const price = await import("@/lib/billing/price");
  const route = await import("@/app/api/pay/create/route");
  // Таблицы заводятся при первом обращении к базе. Тесты считают заказы
  // напрямую, в том числе там, где маршрут отказывает не дойдя до базы, —
  // без этого «заказов нет» падало бы как «нет такой таблицы».
  billing.billingAvailable();
  // Разбор должен существовать: маршрут отказывается продавать то, чего нет.
  // Кладём карточки обоим номерам — «купить чужой разбор» проверяется отдельным
  // тестом, и падать он должен по причине прав, а не из-за пустого кеша.
  const cache = await import("@/lib/cache/redis");
  const keys = await import("@/lib/cache/keys");
  for (const id of [STEAM_ID, OTHER_STEAM_ID]) {
    await cache.setCache(keys.portraitKey(id, "ru"), { title: "карточка" }, 3600);
  }

  return { identity, billing, session, price, route };
}

/** undefined означает «переменной нет вовсе», а не «пустая строка». */
function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

const SECRET = "секрет-подписи-для-теста-подлиннее-тридцати-двух";
const ACCESS_SECRET = "секрет-сессии-для-теста";
const STEAM_ID = "76561197990915489";
const OTHER_STEAM_ID = "76561197990915488";

let dbPath: string;
let nextTelegramId = 1;
let clientIp: string;
let nextIp = 1;

beforeEach(() => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pay-create-")), "billing.db");
  nextTelegramId = 1;
  // Корзина лимита живёт в кеше, а кеш — на globalThis и переживает
  // vi.resetModules(). Каждому тесту свой адрес, иначе они тратят одну корзину
  // на всех и падают по очереди в зависимости от порядка.
  clientIp = `10.0.0.${nextIp++}`;
});

afterEach(() => {
  delete process.env.IDENTITY_DB_PATH;
  delete process.env.ACCESS_SECRET;
  delete process.env.PAYWALL_MODE;
  delete process.env.PAYMENT_WEBHOOK_SECRET;
  delete process.env.PAY_RATE_LIMIT_PER_HOUR;
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

function createRequest(body: unknown, cookie?: string): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    // Адрес клиента берётся из последнего элемента X-Forwarded-For (lib/http/client-ip).
    "x-forwarded-for": clientIp,
  };
  if (cookie) headers["cookie"] = cookie;
  return new Request("https://example.test/api/pay/create", {
    method: "POST",
    body: JSON.stringify(body),
    headers,
  });
}

/** Считает заказы напрямую в базе — независимая проверка, мимо store. */
function countOrders(): number {
  const raw = new Database(dbPath);
  try {
    const row = raw.prepare("SELECT COUNT(*) AS n FROM orders").get() as { n: number };
    return row.n;
  } finally {
    raw.close();
  }
}

describe("создание заказа", () => {
  it("вошедшему отдаёт адрес кассы и заводит заказ на нужную сумму", async () => {
    const { identity, billing, session, price, route } = await freshWorld({ dbPath, mode: "stub" });
    const accountId = makeAccount(identity);

    const res = await route.POST(
      createRequest({ steamId64: STEAM_ID, locale: "ru" }, cookieFor(session, accountId)),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    const order = billing.findOpenOrder(accountId, STEAM_ID)!;
    expect(order).not.toBeNull();
    expect(body.payUrl).toBe(`/ru/pay/${order.id}`);
    expect(order.amountKop).toBe(price.PRICE_KOP);
    expect(order.currency).toBe("RUB");
    // Поддельные заказы не должны смешаться с настоящими в отчётах.
    expect(order.provider).toBe("stub");
    expect(countOrders()).toBe(1);
  });

  it("купить можно и ЧУЖОЙ разбор — владение доказывать не требуется", async () => {
    const { identity, billing, session, route } = await freshWorld({ dbPath, mode: "stub" });
    const accountId = makeAccount(identity);

    const res = await route.POST(
      createRequest({ steamId64: OTHER_STEAM_ID, locale: "ru" }, cookieFor(session, accountId)),
    );

    expect(res.status).toBe(200);
    expect(billing.findOpenOrder(accountId, OTHER_STEAM_ID)).not.toBeNull();
  });
});

describe("без входа покупать нечем", () => {
  it("нет сессии — 401 needLogin, заказа нет", async () => {
    const { route } = await freshWorld({ dbPath, mode: "stub" });

    const res = await route.POST(createRequest({ steamId64: STEAM_ID, locale: "ru" }));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.needLogin).toBe(true);
    expect(countOrders()).toBe(0);
  });

  it("подделанная кука сессии — тоже 401, заказа нет", async () => {
    const { route } = await freshWorld({ dbPath, mode: "stub" });

    // Номер аккаунта настоящий по форме, подпись выдумана: маршрут обязан
    // отказать, а не поверить первому полю.
    const res = await route.POST(
      createRequest({ steamId64: STEAM_ID, locale: "ru" }, `gt_session=1.99999999999.deadbeef`),
    );

    expect(res.status).toBe(401);
    expect(countOrders()).toBe(0);
  });
});

describe("уже купленное не продаётся второй раз", () => {
  it("есть право — 409 alreadyOwned, заказа не создаётся", async () => {
    const { identity, billing, session, route } = await freshWorld({ dbPath, mode: "stub" });
    const accountId = makeAccount(identity);
    // Право выдаётся настоящим путём — через оплату заказа.
    const paid = billing.createOrder({
      accountId,
      steamId64: STEAM_ID,
      amountKop: 19900,
      provider: "stub",
      idempotencyKey: "already-owned",
    })!;
    expect(billing.markPaid(paid.id, "stub-already")).toBe("granted");

    const res = await route.POST(
      createRequest({ steamId64: STEAM_ID, locale: "ru" }, cookieFor(session, accountId)),
    );
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.alreadyOwned).toBe(true);
    // Ровно тот заказ, которым право и куплено, — второго не появилось.
    expect(countOrders()).toBe(1);
  });
});

describe("при выключенной кассе покупать нечего", () => {
  it("PAYWALL_MODE=off — 404, заказа нет", async () => {
    const { identity, session, route } = await freshWorld({ dbPath, mode: "off" });
    const accountId = makeAccount(identity);

    const res = await route.POST(
      createRequest({ steamId64: STEAM_ID, locale: "ru" }, cookieFor(session, accountId)),
    );

    expect(res.status).toBe(404);
    expect(countOrders()).toBe(0);
  });

  it("переменной нет вовсе — тоже 404", async () => {
    const { identity, session, route } = await freshWorld({ dbPath, mode: undefined });
    const accountId = makeAccount(identity);

    const res = await route.POST(
      createRequest({ steamId64: STEAM_ID, locale: "ru" }, cookieFor(session, accountId)),
    );

    expect(res.status).toBe(404);
    expect(countOrders()).toBe(0);
  });
});

describe("двойное нажатие не рождает второй заказ", () => {
  it("два вызова подряд отдают один и тот же адрес кассы", async () => {
    const { identity, session, route } = await freshWorld({ dbPath, mode: "stub" });
    const accountId = makeAccount(identity);
    const cookie = cookieFor(session, accountId);

    const first = await route.POST(createRequest({ steamId64: STEAM_ID, locale: "ru" }, cookie));
    const second = await route.POST(createRequest({ steamId64: STEAM_ID, locale: "ru" }, cookie));

    expect((await first.json()).payUrl).toBe((await second.json()).payUrl);
    expect(countOrders()).toBe(1);
  });

  it("а вот после отменённого заказа покупка начинается заново", async () => {
    const { identity, billing, session, route } = await freshWorld({ dbPath, mode: "stub" });
    const accountId = makeAccount(identity);
    const cookie = cookieFor(session, accountId);

    const first = await route.POST(createRequest({ steamId64: STEAM_ID, locale: "ru" }, cookie));
    const firstUrl = (await first.json()).payUrl as string;
    // Банк отказал — заказ закрыт. Человек жмёт «купить» снова, и ему обязан
    // достаться НОВЫЙ заказ: по отменённому касса денег не возьмёт.
    const openOrder = billing.findOpenOrder(accountId, STEAM_ID)!;
    expect(billing.markCancelled(openOrder.id)).toBe("cancelled");

    const second = await route.POST(createRequest({ steamId64: STEAM_ID, locale: "ru" }, cookie));
    const secondUrl = (await second.json()).payUrl as string;

    expect(second.status).toBe(200);
    expect(secondUrl).not.toBe(firstUrl);
    expect(countOrders()).toBe(2);
  });
});

describe("чужой заказ не достаётся сегодняшней кассе", () => {
  it("открытый заказ другого приёмщика не переиспользуется", async () => {
    const { identity, billing, session, price, route } = await freshWorld({ dbPath, mode: "stub" });
    const accountId = makeAccount(identity);
    // Ключ идемпотентности берём ровно тот, что сложит маршрут (аккаунт, разбор
    // и цена совпадают): так проверяется и обход по солёному ключу, а не только
    // первая ветка.
    const foreign = billing.createOrder({
      accountId,
      steamId64: STEAM_ID,
      amountKop: price.PRICE_KOP,
      provider: "yookassa",
      idempotencyKey: `pay:v1:${accountId}:${STEAM_ID}:${price.PRICE_KOP}`,
    })!;

    const res = await route.POST(
      createRequest({ steamId64: STEAM_ID, locale: "ru" }, cookieFor(session, accountId)),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    // Иначе владелец переключил бы live, вернувшийся посетитель заплатил бы
    // настоящими деньгами по заказу с provider = 'stub', и в отчётах эта оплата
    // лежала бы тестовой — при сверке с банком это расхождение.
    expect(body.payUrl).not.toBe(`/ru/pay/${foreign.id}`);
    expect(countOrders()).toBe(2);

    const usedId = Number(String(body.payUrl).split("/").pop());
    expect(billing.findOrder(usedId)!.provider).toBe("stub");
    // Чужой заказ не тронут: закрывать его не наше дело.
    expect(billing.findOrder(foreign.id)!.status).toBe("created");
  });
});

describe("частые попытки начать покупку упираются в потолок", () => {
  it("сверх потолка — 429, и лишних заказов не появляется", async () => {
    const { identity, session, route } = await freshWorld({ dbPath, mode: "stub", rateLimit: "2" });
    const cookie = cookieFor(session, makeAccount(identity));

    // Номера разные намеренно: существование профиля здесь не проверяется, и
    // каждая попытка с новым номером пишет НОВУЮ строку в базу заказов — в тот
    // же файл, где лежат аккаунты и права.
    const first = await route.POST(createRequest({ steamId64: STEAM_ID, locale: "ru" }, cookie));
    const second = await route.POST(createRequest({ steamId64: OTHER_STEAM_ID, locale: "ru" }, cookie));
    const third = await route.POST(
      createRequest({ steamId64: "76561197990915487", locale: "ru" }, cookie),
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);
    expect(countOrders()).toBe(2);
  });
});

describe("что приходит в теле запроса, тому верить нельзя", () => {
  it("мусорный steamId64 — 400, заказа нет", async () => {
    const { identity, session, route } = await freshWorld({ dbPath, mode: "stub" });
    const cookie = cookieFor(session, makeAccount(identity));

    for (const steamId64 of ["", "не число", "123", 76561197990915489, null]) {
      const res = await route.POST(createRequest({ steamId64, locale: "ru" }, cookie));
      expect(res.status).toBe(400);
    }
    expect(countOrders()).toBe(0);
  });

  it("чужая локаль не подставляется в адрес кассы", async () => {
    const { identity, session, route } = await freshWorld({ dbPath, mode: "stub" });
    const cookie = cookieFor(session, makeAccount(identity));

    // Локаль уезжает в путь адреса оплаты — принимать оттуда что попало
    // нельзя: «../../» увело бы человека не на кассу, а куда угодно.
    const res = await route.POST(
      createRequest({ steamId64: STEAM_ID, locale: "../../evil" }, cookie),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.payUrl).toMatch(/^\/ru\/pay\/\d+$/);
  });

  it("тело не разбирается как JSON — 400, заказа нет", async () => {
    const { identity, session, route } = await freshWorld({ dbPath, mode: "stub" });
    const cookie = cookieFor(session, makeAccount(identity));

    const res = await route.POST(
      new Request("https://example.test/api/pay/create", {
        method: "POST",
        body: "не json",
        headers: { "content-type": "application/json", cookie },
      }),
    );

    expect(res.status).toBe(400);
    expect(countOrders()).toBe(0);
  });
});

describe("беда на нашей стороне не открывает доступ", () => {
  /** Каталога не существует — база не откроется никогда, а не разово. */
  const brokenPath = "/nonexistent-dir-для-теста/billing.db";

  it("недоступная база — 5xx и никакого адреса кассы", async () => {
    const { session, route } = await freshWorld({ dbPath: brokenPath, mode: "stub" });

    // Кука подписана честно: аккаунта в базе нет, потому что базы нет вовсе.
    const res = await route.POST(
      createRequest({ steamId64: STEAM_ID, locale: "ru" }, cookieFor(session, 1)),
    );
    const body = await res.json();

    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(body.payUrl).toBeUndefined();
  });

  it("режим live пока не подключён — 503, а не молчаливая заглушка", async () => {
    const { identity, session, route } = await freshWorld({ dbPath, mode: "live" });
    const accountId = makeAccount(identity);

    const res = await route.POST(
      createRequest({ steamId64: STEAM_ID, locale: "ru" }, cookieFor(session, accountId)),
    );

    expect(res.status).toBe(503);
    // Отказ постоянный, и витрина обязана уметь отличить его от «попробуйте
    // ещё раз»: приёмщика при live нет ВСЕГДА, пока владелец не подключит кассу.
    expect((await res.json()).code).toBe("no_provider");
    expect(countOrders()).toBe(0);
  });
});

describe("платить за несуществующий разбор нельзя", () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pay-create-")), "identity.db");
  });

  it("на номер без карточки заказ не заводится", async () => {
    // Раньше можно было отправить любые семнадцать цифр и заплатить 199 ₽ за
    // страницу «данные устарели»: существование разбора не проверялось вовсе.
    const { identity, billing, session, route } = await freshWorld({ dbPath, mode: "stub" });
    const accountId = makeAccount(identity);
    const NO_CARD = "76561197990915400";

    const res = await route.POST(
      createRequest({ steamId64: NO_CARD, locale: "ru" }, cookieFor(session, accountId)),
    );

    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("no_analysis");
    expect(billing.findOpenOrder(accountId, NO_CARD)).toBeNull();
  });
});
