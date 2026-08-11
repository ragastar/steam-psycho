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
});
