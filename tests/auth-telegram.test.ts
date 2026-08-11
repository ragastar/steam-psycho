import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

async function freshModules(dbPath: string) {
  process.env.IDENTITY_DB_PATH = dbPath;
  process.env.ACCESS_SECRET = "секрет-подлиннее-шестнадцати";
  vi.resetModules();
  const claim = await import("@/app/api/auth/telegram/claim/route");
  const cache = await import("@/lib/cache/redis");
  const keys = await import("@/lib/cache/keys");
  return { claim, cache, keys };
}

let dbPath: string;

beforeEach(() => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "auth-tg-")), "identity.db");
});

afterEach(() => {
  delete process.env.IDENTITY_DB_PATH;
  delete process.env.ACCESS_SECRET;
  vi.resetModules();
});

function request(body: unknown): Request {
  return new Request("http://localhost/api/auth/telegram/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("вход через Telegram", () => {
  it("неподтверждённый токен доступа не даёт", async () => {
    const { claim, cache, keys } = await freshModules(dbPath);
    await cache.setCache(keys.loginTokenKey("тк1"), { status: "pending" }, 600);

    const res = await claim.POST(request({ token: "тк1" }));

    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("несуществующий токен доступа не даёт", async () => {
    const { claim } = await freshModules(dbPath);

    const res = await claim.POST(request({ token: "какой-то" }));

    expect(res.status).toBe(403);
  });

  it("подтверждённый токен заводит аккаунт и ставит куку", async () => {
    const { claim, cache, keys } = await freshModules(dbPath);
    await cache.setCache(
      keys.loginTokenKey("тк2"),
      { status: "confirmed", telegramUserId: "12345" },
      600,
    );

    const res = await claim.POST(request({ token: "тк2" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.accountId).toBeGreaterThan(0);
    expect(res.headers.get("set-cookie")).toContain("gt_session=");
  });

  it("токен одноразовый: второй обмен не проходит", async () => {
    const { claim, cache, keys } = await freshModules(dbPath);
    await cache.setCache(
      keys.loginTokenKey("тк3"),
      { status: "confirmed", telegramUserId: "12345" },
      600,
    );

    await claim.POST(request({ token: "тк3" }));
    const second = await claim.POST(request({ token: "тк3" }));

    expect(second.status).toBe(403);
  });
});
