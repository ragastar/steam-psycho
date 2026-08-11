import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

async function freshModules(dbPath: string) {
  process.env.IDENTITY_DB_PATH = dbPath;
  process.env.ACCESS_SECRET = "секрет-подлиннее-шестнадцати";
  process.env.NEXT_PUBLIC_TELEGRAM_BOT = "gamertype_bot";
  vi.resetModules();
  const start = await import("@/app/api/auth/telegram/start/route");
  const claim = await import("@/app/api/auth/telegram/claim/route");
  const cache = await import("@/lib/cache/redis");
  const keys = await import("@/lib/cache/keys");
  const session = await import("@/lib/identity/session");
  const store = await import("@/lib/identity/store");
  return { start, claim, cache, keys, session, store };
}

let dbPath: string;

beforeEach(() => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "auth-tg-")), "identity.db");
});

afterEach(() => {
  delete process.env.IDENTITY_DB_PATH;
  delete process.env.ACCESS_SECRET;
  delete process.env.NEXT_PUBLIC_TELEGRAM_BOT;
  vi.resetModules();
});

/**
 * Запрос на обмен токена. `cookie` — сырой заголовок: тесты подделки
 * браузера как раз про то, ЧТО в нём лежит.
 */
function request(body: unknown, cookie?: string): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie !== undefined) headers.cookie = cookie;
  return new Request("http://localhost/api/auth/telegram/claim", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("вход через Telegram", () => {
  it("неподтверждённый токен доступа не даёт", async () => {
    const { claim, cache, keys } = await freshModules(dbPath);
    await cache.setCache(keys.loginTokenKey("tk1"), { status: "pending" }, 600);

    const res = await claim.POST(request({ token: "tk1" }, "gt_login=tk1"));

    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("несуществующий токен доступа не даёт", async () => {
    const { claim } = await freshModules(dbPath);

    const res = await claim.POST(request({ token: "no-such-token" }, "gt_login=no-such-token"));

    expect(res.status).toBe(403);
  });

  it("подтверждённый токен заводит аккаунт и ставит куку", async () => {
    const { claim, cache, keys } = await freshModules(dbPath);
    await cache.setCache(
      keys.loginTokenKey("tk2"),
      { status: "confirmed", telegramUserId: "12345" },
      600,
    );

    const res = await claim.POST(request({ token: "tk2" }, "gt_login=tk2"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.accountId).toBeGreaterThan(0);
    expect(res.cookies.get("gt_session")?.value).toBeTruthy();
  });

  it("токен одноразовый: второй обмен не проходит", async () => {
    const { claim, cache, keys } = await freshModules(dbPath);
    await cache.setCache(
      keys.loginTokenKey("tk3"),
      { status: "confirmed", telegramUserId: "12345" },
      600,
    );

    await claim.POST(request({ token: "tk3" }, "gt_login=tk3"));
    const second = await claim.POST(request({ token: "tk3" }, "gt_login=tk3"));

    expect(second.status).toBe(403);
  });
});

/**
 * Угон аккаунта через вход Telegram.
 *
 * Токен выдаётся браузеру, подтверждается ботом от имени того, кто открыл
 * ссылку, и обменивается на сессию тем, кто токен предъявил. Если эти три
 * шага ничем не связаны, злоумышленник берёт токен себе, шлёт ссылку жертве
 * и получает сессию НА ЕЁ аккаунт. Связывает их одноразовая кука, выданная
 * на /start тому браузеру, который вход начал.
 */
describe("токен входа привязан к браузеру, который его получил", () => {
  it("/start отдаёт токен и ставит куку с ним же", async () => {
    const { start } = await freshModules(dbPath);

    const res = await start.POST();
    const body = await res.json();

    expect(body.token).toBeTruthy();
    expect(body.url).toContain(`start=login_${body.token}`);
    const cookie = res.cookies.get("gt_login");
    expect(cookie?.value).toBe(body.token);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
    expect(cookie?.path).toBe("/");
  });

  it("чужой браузер с чужой кукой обменять подтверждённый токен не может", async () => {
    const { start, claim, cache, keys } = await freshModules(dbPath);

    // Жертва начала свой вход — у неё в браузере кука со СВОИМ токеном.
    const victimStart = await start.POST();
    const victimToken = (await victimStart.json()).token as string;

    // Злоумышленник получил свой токен и подтвердил его руками жертвы.
    const attackerStart = await start.POST();
    const attackerToken = (await attackerStart.json()).token as string;
    await cache.setCache(
      keys.loginTokenKey(attackerToken),
      { status: "confirmed", telegramUserId: "999" },
      600,
    );

    // Но обменивает его браузер, в котором лежит другая кука.
    const res = await claim.POST(
      request({ token: attackerToken }, `gt_login=${victimToken}`),
    );

    expect(res.status).toBe(403);
    expect(res.cookies.get("gt_session")).toBeUndefined();
  });

  it("браузер без куки обменять подтверждённый токен не может", async () => {
    const { start, claim, cache, keys } = await freshModules(dbPath);
    const started = await start.POST();
    const token = (await started.json()).token as string;
    await cache.setCache(
      keys.loginTokenKey(token),
      { status: "confirmed", telegramUserId: "999" },
      600,
    );

    const res = await claim.POST(request({ token }));

    expect(res.status).toBe(403);
    expect(res.cookies.get("gt_session")).toBeUndefined();
  });

  it("кука с похожим именем настоящей не считается", async () => {
    const { start, claim, cache, keys } = await freshModules(dbPath);
    const started = await start.POST();
    const token = (await started.json()).token as string;
    await cache.setCache(
      keys.loginTokenKey(token),
      { status: "confirmed", telegramUserId: "999" },
      600,
    );

    // xgt_login — не gt_login. Нестрогая регулярка без границы имени
    // считала бы иначе, и привязку к браузеру можно было бы подделать.
    const res = await claim.POST(request({ token }, `xgt_login=${token}`));

    expect(res.status).toBe(403);
    expect(res.cookies.get("gt_session")).toBeUndefined();
  });

  it("свой браузер обменивает токен и кука привязки гасится", async () => {
    const { start, claim, cache, keys } = await freshModules(dbPath);
    const started = await start.POST();
    const token = (await started.json()).token as string;
    await cache.setCache(
      keys.loginTokenKey(token),
      { status: "confirmed", telegramUserId: "777" },
      600,
    );

    const res = await claim.POST(request({ token }, `gt_login=${token}`));

    expect(res.status).toBe(200);
    expect(res.cookies.get("gt_session")?.value).toBeTruthy();
    // Кука одноразовая: после обмена от неё не должно остаться значения.
    expect(res.cookies.get("gt_login")?.value).toBe("");
  });

  it("токен, подтверждённый ботом, не отдаётся чужому браузеру даже с чужой сессией", async () => {
    const { start, claim, cache, keys, session, store } = await freshModules(dbPath);
    const started = await start.POST();
    const token = (await started.json()).token as string;
    await cache.setCache(
      keys.loginTokenKey(token),
      { status: "confirmed", telegramUserId: "555" },
      600,
    );

    const own = store.loginOrCreate("steam", "76561197990915489", { verified: true });
    const accountId = own.status === "ok" ? own.accountId : 0;
    const sess = session.issueSessionCookie(accountId);

    // Есть своя сессия, но нет привязки токена к этому браузеру — отказ.
    const res = await claim.POST(request({ token }, `gt_session=${sess.value}`));

    expect(res.status).toBe(403);
  });
});

describe("привязка, занятая другим аккаунтом, даёт отказ на маршруте", () => {
  it("подтверждённый токен чужой привязки отвечает 409 и сессию не меняет", async () => {
    const { start, claim, cache, keys, session, store } = await freshModules(dbPath);

    // Телеграм 4242 уже принадлежит первому аккаунту.
    const first = store.loginOrCreate("telegram", "4242");
    expect(first.status).toBe("ok");

    // Второй аккаунт вошёл через Steam и пытается привязать чужой телеграм.
    const second = store.loginOrCreate("steam", "76561197990915489", { verified: true });
    const secondId = second.status === "ok" ? second.accountId : 0;
    const sess = session.issueSessionCookie(secondId);

    const started = await start.POST();
    const token = (await started.json()).token as string;
    await cache.setCache(
      keys.loginTokenKey(token),
      { status: "confirmed", telegramUserId: "4242" },
      600,
    );

    const res = await claim.POST(
      request({ token }, `gt_login=${token}; gt_session=${sess.value}`),
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "taken" });
    // Молчаливой склейки аккаунтов нет: новой сессии не выдали.
    expect(res.cookies.get("gt_session")).toBeUndefined();
  });
});
