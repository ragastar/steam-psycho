import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * Приёмник обратной связи. База своя во временной папке на каждый тест —
 * иначе второй тест читает написанное первым.
 */
const rateLimitCount = vi.hoisted(() => ({ value: 1 }));

vi.mock("@/lib/cache/redis", () => ({
  incrementRateLimit: async () => rateLimitCount.value,
}));

vi.mock("@/lib/http/client-ip", () => ({ getClientIp: () => "1.2.3.4" }));
vi.mock("@/lib/analytics/hash", () => ({ hashIp: () => "хеш" }));

let dbPath: string;

async function freshRoute() {
  process.env.ANALYTICS_DB_PATH = dbPath;
  vi.resetModules();
  return {
    route: await import("@/app/api/feedback/route"),
    queries: await import("@/lib/analytics/queries"),
  };
}

const post = (body: unknown) =>
  new Request("http://localhost/api/feedback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

beforeEach(() => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "feedback-")), "analytics.db");
  rateLimitCount.value = 1;
});

afterEach(() => {
  delete process.env.ANALYTICS_DB_PATH;
  vi.resetModules();
});

describe("обратная связь", () => {
  it("записывает сообщение и показывает его админке", async () => {
    const { route, queries } = await freshRoute();

    const res = await route.POST(post({ text: "шляпа не работает", contact: "@vasya", steamId64: "76561198000000001" }));

    expect(res.status).toBe(200);
    const rows = queries.getRecentFeedback();
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe("шляпа не работает");
    expect(rows[0].contact).toBe("@vasya");
    expect(rows[0].steam_id64).toBe("76561198000000001");
  });

  it("не принимает пустое — это промах по кнопке, а не мнение", async () => {
    const { route, queries } = await freshRoute();

    expect((await route.POST(post({ text: "   " }))).status).toBe(400);
    expect((await route.POST(post({ text: "я" }))).status).toBe(400);
    expect(queries.getRecentFeedback()).toHaveLength(0);
  });

  it("не падает на битом теле запроса", async () => {
    const { route } = await freshRoute();

    expect((await route.POST(post("не json"))).status).toBe(400);
  });

  it("обрезает слишком длинное, а не отказывает", async () => {
    // Человек вставил простыню — это не повод терять его сообщение целиком.
    const { route, queries } = await freshRoute();

    await route.POST(post({ text: "а".repeat(10_000) }));

    expect(queries.getRecentFeedback()[0].text.length).toBe(4000);
  });

  it("держит потолок на адрес", async () => {
    const { route, queries } = await freshRoute();
    rateLimitCount.value = 99;

    expect((await route.POST(post({ text: "спам" }))).status).toBe(429);
    expect(queries.getRecentFeedback()).toHaveLength(0);
  });

  it("доступ не спрашивается: пишет и тот, кто не платил", async () => {
    // Проверка в самом маршруте: никакого getAccessLevel там быть не должно.
    const source = fs.readFileSync("app/api/feedback/route.ts", "utf8");
    expect(source).not.toContain("getAccessLevel");
    expect(source).not.toContain("steamIdHasEntitlement");
  });
});
