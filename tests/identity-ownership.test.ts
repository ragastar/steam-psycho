import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

async function freshStore(dbPath: string) {
  process.env.IDENTITY_DB_PATH = dbPath;
  vi.resetModules();
  return import("@/lib/identity/store");
}

let dbPath: string;

beforeEach(() => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "owner-")), "identity.db");
});

afterEach(() => {
  delete process.env.IDENTITY_DB_PATH;
  vi.resetModules();
});

describe("владение профилем", () => {
  it("подтверждённая привязка Steam делает аккаунт владельцем", async () => {
    const store = await freshStore(dbPath);
    const res = store.loginOrCreate("steam", "76561197990915489", { verified: true });
    const accountId = res.status === "ok" ? res.accountId : 0;

    expect(store.accountOwnsSteamId(accountId, "76561197990915489")).toBe(true);
  });

  it("вход через Telegram владельцем не делает", async () => {
    const store = await freshStore(dbPath);
    const res = store.loginOrCreate("telegram", "12345");
    const accountId = res.status === "ok" ? res.accountId : 0;

    expect(store.accountOwnsSteamId(accountId, "76561197990915489")).toBe(false);
  });

  it("чужой steamId владением не считается", async () => {
    const store = await freshStore(dbPath);
    const res = store.loginOrCreate("steam", "76561197990915489", { verified: true });
    const accountId = res.status === "ok" ? res.accountId : 0;

    expect(store.accountOwnsSteamId(accountId, "76561198028121353")).toBe(false);
  });

  it("неподтверждённая привязка Steam владельцем не делает", async () => {
    const store = await freshStore(dbPath);
    // verified: false явно, а не пропуск opts — так честнее видно намерение
    // теста: привязка ЕСТЬ, но владение ею не доказано.
    const res = store.loginOrCreate("steam", "76561197990915489", { verified: false });
    const accountId = res.status === "ok" ? res.accountId : 0;

    expect(store.accountOwnsSteamId(accountId, "76561197990915489")).toBe(false);
  });
  it("недоступная база означает «не владелец», а не падение страницы", async () => {
    // Страница результата спрашивает владение ради одного бейджа. Раньше
    // открытие базы не было обёрнуто в try/catch, и любая беда с ней
    // превращалась в 500 на главной странице продукта.
    const store = await freshStore("/nonexistent-dir-для-теста/identity.db");

    expect(store.accountOwnsSteamId(1, "76561197990915489")).toBe(false);
  });
});
