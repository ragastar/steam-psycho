import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

let dbPath: string;

beforeEach(() => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "auth-me-")), "identity.db");
  process.env.IDENTITY_DB_PATH = dbPath;
});

afterEach(() => {
  delete process.env.IDENTITY_DB_PATH;
  vi.resetModules();
  vi.doUnmock("@/lib/identity/session");
});

describe("кто вошёл", () => {
  it("без сессии отдаёт пустой ответ", async () => {
    vi.doMock("@/lib/identity/session", () => ({ getCurrentAccountId: async () => null }));
    vi.resetModules();
    const { GET } = await import("@/app/api/auth/me/route");

    const res = await GET();
    const body = await res.json();

    expect(body).toEqual({ accountId: null, identities: [] });
  });

  it("не отдаёт наружу providerId — только provider и verified", async () => {
    const { loginOrCreate } = await import("@/lib/identity/store");
    const login = loginOrCreate("telegram", "секретный-tg-id-12345", { verified: true });
    expect(login.status).toBe("ok");
    if (login.status !== "ok") throw new Error("unreachable");

    vi.doMock("@/lib/identity/session", () => ({ getCurrentAccountId: async () => login.accountId }));
    vi.resetModules();
    const { GET } = await import("@/app/api/auth/me/route");

    const res = await GET();
    const raw = await res.text();

    // Идентификатор привязки не должен утечь в ответ ни в каком виде.
    expect(raw).not.toContain("секретный-tg-id-12345");

    const body = JSON.parse(raw);
    expect(body.accountId).toBe(login.accountId);
    expect(body.identities).toEqual([{ provider: "telegram", verified: true }]);
  });
});
