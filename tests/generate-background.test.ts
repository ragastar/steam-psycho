import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Генерация в фоне: маршрут отвечает сразу, состояние спрашивают отдельно.
 *
 * Кеш подменён картой — здесь важны переходы состояний, а не хранилище.
 */
const cache = vi.hoisted(() => new Map<string, unknown>());
const generatePortrait = vi.hoisted(() => vi.fn());

vi.mock("@/lib/cache/redis", () => ({
  getCache: async (key: string) => cache.get(key) ?? null,
  setCache: async (key: string, value: unknown) => void cache.set(key, value),
  deleteCache: async (key: string) => void cache.delete(key),
  incrementRateLimit: async () => 1,
}));

vi.mock("@/lib/llm/client", () => ({ generatePortrait: (...a: unknown[]) => generatePortrait(...a) }));
vi.mock("@/lib/analytics/db", () => ({ logAnalysis: () => {}, logError: () => {} }));
vi.mock("@/lib/analytics/hash", () => ({ hashIp: () => "хеш" }));
vi.mock("@/lib/http/client-ip", () => ({ getClientIp: () => "1.2.3.4" }));
vi.mock("@/lib/billing/store", () => ({ steamIdHasEntitlement: () => false }));
vi.mock("@/lib/access/entitlement", () => ({ paywallMode: () => "off" }));
vi.mock("@/lib/llm/facts", () => ({ applyComputedFacts: (p: unknown) => p }));

const ID = "76561198000000001";

/** Ждёт условия, а не времени: фоновая работа заканчивается когда закончится. */
async function waitFor(check: () => Promise<boolean>, limitMs = 2000): Promise<void> {
  const deadline = Date.now() + limitMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("не дождались состояния");
}

async function route() {
  vi.resetModules();
  return import("@/app/api/generate/route");
}

const post = () =>
  new Request("http://localhost/api/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ steamId64: ID, locale: "ru" }),
  });

const get = () => new Request(`http://localhost/api/generate?steamId64=${ID}&locale=ru`);

/** Разбор и спутники, без которых маршрут отвечает «данные устарели». */
function seedProfile() {
  cache.set(`profile:v3:${ID}`, { stats: { totalGames: 10, totalPlaytimeHours: 100 }, timeline: {}, genreDistribution: [], tagDistribution: [] });
  cache.set(`cardstats:v1:${ID}`, { dedication: 50, mastery: 50, exploration: 50, hoarding: 50, social: 50, veteran: 50 });
  cache.set(`rarity:v2:${ID}`, "rare");
}

beforeEach(() => {
  cache.clear();
  generatePortrait.mockReset();
});

describe("генерация в фоне", () => {
  it("маршрут отвечает сразу, не дожидаясь модели", async () => {
    seedProfile();
    // Модель «пишет» долго и завершится уже после ответа.
    let finish: (v: unknown) => void = () => {};
    generatePortrait.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { POST, GET } = await route();

    const res = await POST(post());

    expect(await res.json()).toEqual({ status: "pending" });
    expect(await (await GET(get())).json()).toEqual({ status: "pending" });

    finish({ portrait: { primaryArchetype: {}, spirit_animal: {} }, provider: "тест", model: "тест" });
    await waitFor(async () => (await (await GET(get())).json()).status === "ready");

    expect((await (await GET(get())).json()).status).toBe("ready");
  });

  it("вторую генерацию того же человека не запускает — каждая стоит денег", async () => {
    seedProfile();
    generatePortrait.mockReturnValue(new Promise(() => {}));
    const { POST } = await route();

    await POST(post());
    await POST(post());

    expect(generatePortrait).toHaveBeenCalledTimes(1);
  });

  it("падение модели видно опросу, и замок отпускается", async () => {
    seedProfile();
    generatePortrait.mockRejectedValue(new Error("мост лёг"));
    const { POST, GET } = await route();

    await POST(post());
    // Ждём именно состояния, а не «сколько-то миллисекунд»: путь падения
    // проходит через журнал и два обращения к кешу, и фиксированная пауза
    // делает тест хрупким.
    await waitFor(async () => (await (await GET(get())).json()).status === "failed");

    expect(await (await GET(get())).json()).toEqual({ status: "failed", code: "GENERATE_ERROR" });
    // Замок снят: следующая попытка должна начаться, а не упереться в него.
    // Ждём именно вызова модели: маршрут отвечает раньше, чем фоновая работа
    // до неё доходит, — в этом весь смысл переделки.
    await POST(post());
    await waitFor(async () => generatePortrait.mock.calls.length === 2);
  });

  it("готовую карточку отдаёт сразу и модель не зовёт", async () => {
    seedProfile();
    cache.set(`portrait:v7:${ID}:ru`, { title: "готово" });
    const { POST, GET } = await route();

    expect(await (await POST(post())).json()).toEqual({ status: "ready" });
    expect(await (await GET(get())).json()).toEqual({ status: "ready" });
    expect(generatePortrait).not.toHaveBeenCalled();
  });

  it("без разбора отвечает «данные устарели», а не запускает пустую генерацию", async () => {
    const { POST } = await route();

    const res = await POST(post());

    expect(res.status).toBe(410);
    expect(generatePortrait).not.toHaveBeenCalled();
  });

  it("состояние спрашивают только по правильному номеру", async () => {
    const { GET } = await route();

    const res = await GET(new Request("http://localhost/api/generate?steamId64=нет&locale=ru"));

    expect(res.status).toBe(400);
  });
});
