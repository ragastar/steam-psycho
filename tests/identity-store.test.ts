import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * У хранилища личности своё соединение, которое кешируется в модуле.
 * Поэтому каждому тесту нужна своя база И свежий импорт модуля —
 * иначе второй тест работает с базой первого.
 */
async function freshStore(dbPath: string) {
  process.env.IDENTITY_DB_PATH = dbPath;
  vi.resetModules();
  return import("@/lib/identity/store");
}

let dbPath: string;

beforeEach(() => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "identity-")), "identity.db");
});

afterEach(() => {
  delete process.env.IDENTITY_DB_PATH;
  vi.resetModules();
});

describe("хранилище личности", () => {
  it("первый вход заводит аккаунт", async () => {
    const store = await freshStore(dbPath);

    const res = store.loginOrCreate("telegram", "12345");

    expect(res.status).toBe("ok");
    expect(res.status === "ok" && res.accountId).toBeGreaterThan(0);
  });

  it("повторный вход тем же способом попадает в тот же аккаунт", async () => {
    const store = await freshStore(dbPath);

    const first = store.loginOrCreate("telegram", "12345");
    const second = store.loginOrCreate("telegram", "12345");

    expect(first).toEqual(second);
  });

  it("вход другим способом при живой сессии привязывается к тому же аккаунту", async () => {
    const store = await freshStore(dbPath);
    const tg = store.loginOrCreate("telegram", "12345");
    const accountId = tg.status === "ok" ? tg.accountId : 0;

    const steam = store.loginOrCreate("steam", "76561197990915489", {
      currentAccountId: accountId,
      verified: true,
    });

    expect(steam).toEqual({ status: "ok", accountId });
    expect(store.listIdentities(accountId)).toEqual([
      { provider: "telegram", providerId: "12345", verified: false },
      { provider: "steam", providerId: "76561197990915489", verified: true },
    ]);
  });

  it("занятую привязку не уводит в чужой аккаунт", async () => {
    const store = await freshStore(dbPath);
    store.loginOrCreate("steam", "76561197990915489", { verified: true });
    const other = store.loginOrCreate("telegram", "99999");
    const otherId = other.status === "ok" ? other.accountId : 0;

    const res = store.loginOrCreate("steam", "76561197990915489", {
      currentAccountId: otherId,
      verified: true,
    });

    expect(res).toEqual({ status: "taken" });
  });

  it("неизвестная привязка при живой сессии не создаёт второй аккаунт", async () => {
    const store = await freshStore(dbPath);
    const tg = store.loginOrCreate("telegram", "12345");
    const accountId = tg.status === "ok" ? tg.accountId : 0;

    store.loginOrCreate("steam", "76561197990915489", { currentAccountId: accountId });

    expect(store.findAccountByIdentity("steam", "76561197990915489")).toBe(accountId);
  });
});
