import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

/** Алфавит кода: без похожих друг на друга I, O, 0 и 1 — код вводят руками. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

async function freshModules(dbPath: string) {
  process.env.IDENTITY_DB_PATH = dbPath;
  process.env.ACCESS_SECRET = "секрет-подлиннее-шестнадцати";
  vi.resetModules();
  const claim = await import("@/app/api/auth/telegram/claim/route");
  const handlers = await import("@/lib/telegram/handlers");
  const cache = await import("@/lib/cache/redis");
  const keys = await import("@/lib/cache/keys");
  const session = await import("@/lib/identity/session");
  const store = await import("@/lib/identity/store");
  return { claim, handlers, cache, keys, session, store };
}

let dbPath: string;

beforeEach(() => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tg-code-")), "identity.db");
});

afterEach(() => {
  delete process.env.IDENTITY_DB_PATH;
  delete process.env.ACCESS_SECRET;
  vi.resetModules();
});

/**
 * Запрос на обмен кода.
 *
 * Адрес у каждого случая свой: счётчик попыток живёт в кеше на globalThis и
 * переживает vi.resetModules, поэтому общий адрес складывал бы попытки разных
 * тестов в одну корзину и упирался в потолок не там, где надо.
 */
function request(body: unknown, opts: { ip: string; cookie?: string }): Request {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-forwarded-for": opts.ip,
  };
  if (opts.cookie !== undefined) headers.cookie = opts.cookie;
  return new Request("http://localhost/api/auth/telegram/claim", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("бот выдаёт код входа", () => {
  it("код из 8 знаков разрешённого алфавита, в кеше — кто его получил", async () => {
    const { handlers, cache, keys } = await freshModules(dbPath);

    const code = await handlers.issueLoginCode(4242);

    expect(code).toHaveLength(8);
    for (const ch of code) expect(ALPHABET).toContain(ch);
    expect(await cache.getCache(keys.loginCodeKey(code))).toEqual({ telegramUserId: 4242 });
  });
});

describe("сайт принимает код входа", () => {
  it("верный код обменивается на сессию", async () => {
    const { claim, handlers } = await freshModules(dbPath);
    const code = await handlers.issueLoginCode(4242);

    const res = await claim.POST(request({ code }, { ip: "10.0.0.1" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.accountId).toBeGreaterThan(0);
    expect(res.headers.get("set-cookie")).toContain("gt_session=");
  });

  it("код одноразовый: второй обмен даёт отказ", async () => {
    const { claim, handlers } = await freshModules(dbPath);
    const code = await handlers.issueLoginCode(4242);

    await claim.POST(request({ code }, { ip: "10.0.0.2" }));
    const second = await claim.POST(request({ code }, { ip: "10.0.0.2" }));

    expect(second.status).toBe(403);
  });

  it("неизвестный код доступа не даёт", async () => {
    const { claim } = await freshModules(dbPath);

    const res = await claim.POST(request({ code: "ZZZZZZZZ" }, { ip: "10.0.0.3" }));

    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("код терпит пробелы по краям и нижний регистр", async () => {
    // Код читают из переписки и вставляют — с пробелом и как получится.
    const { claim, cache, keys } = await freshModules(dbPath);
    await cache.setCache(keys.loginCodeKey("K7P2ABCD"), { telegramUserId: 4242 }, 600);

    const res = await claim.POST(request({ code: " k7p2abcd " }, { ip: "10.0.0.4" }));

    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("gt_session=");
  });

  it("больше десяти попыток с одного адреса за час упираются в ограничитель", async () => {
    // Кодов из 8 знаков много, но без потолка их перебирают машиной.
    const { claim } = await freshModules(dbPath);

    for (let i = 0; i < 10; i++) {
      const res = await claim.POST(request({ code: "ZZZZZZZZ" }, { ip: "10.0.0.5" }));
      expect(res.status).toBe(403);
    }

    const res = await claim.POST(request({ code: "ZZZZZZZZ" }, { ip: "10.0.0.5" }));

    expect(res.status).toBe(429);
  });

  it("привязка, занятая другим аккаунтом, даёт 409 и сессию не меняет", async () => {
    const { claim, handlers, session, store } = await freshModules(dbPath);

    // Телеграм 4242 уже принадлежит первому аккаунту.
    expect(store.loginOrCreate("telegram", "4242").status).toBe("ok");

    // Второй аккаунт вошёл через Steam и пытается привязать чужой телеграм.
    const second = store.loginOrCreate("steam", "76561197990915489", { verified: true });
    const secondId = second.status === "ok" ? second.accountId : 0;
    const sess = session.issueSessionCookie(secondId);

    const code = await handlers.issueLoginCode(4242);
    const res = await claim.POST(
      request({ code }, { ip: "10.0.0.7", cookie: `gt_session=${sess.value}` }),
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "taken" });
    // Молчаливой склейки аккаунтов нет: новой сессии не выдали.
    expect(res.cookies.get("gt_session")).toBeUndefined();
  });
});
