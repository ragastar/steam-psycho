import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildAggregatedProfile } from "@/lib/aggregation/aggregate";
import { cardStatsKey, portraitKey, profileKey, rarityKey } from "@/lib/cache/keys";
import { portraitFixture, player, game, noBadges, noAchievements, noRecent } from "./fixtures";
import type { CardStats } from "@/lib/aggregation/aggregate";

/**
 * Генерация карточки бесплатна — и это не удобство, а условие того, что кассу
 * вообще можно включить.
 *
 * Раньше `/api/generate` отвечал 403 всем, у кого нет полного доступа. При
 * `PAYWALL_MODE=stub` это тупик: портрет не создаётся ни у кого, кроме уже
 * заплативших, а платить не за что — бесплатного вердикта никто никогда не
 * увидит. Спека (раздел «Поток», шаги 1–3) требует обратного порядка: сначала
 * разбор и генерация, потом деньги.
 *
 * Утечка платного при этом закрыта не здесь, а на выдаче: в браузер уезжает
 * только `toFreePortrait` (см. tests/redact-portrait.test.ts). Этот тест
 * стережёт возврат тупика.
 */

/** Кука сессии отсутствует — «никто не вошёл» по-настоящему, а не по исключению. */
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

const cache = new Map<string, unknown>();
const written = new Map<string, unknown>();

vi.mock("@/lib/cache/redis", () => ({
  getCache: async (key: string) => cache.get(key) ?? null,
  setCache: async (key: string, value: unknown) => {
    written.set(key, value);
  },
  deleteCache: async (key: string) => {
    written.delete(key);
  },
  incrementRateLimit: async () => 1,
}));

const generatePortrait = vi.fn();
vi.mock("@/lib/llm/client", () => ({
  generatePortrait: (...args: unknown[]) => generatePortrait(...args),
}));

// Аналитика пишет в SQLite — в тесте ей делать нечего.
vi.mock("@/lib/analytics/db", () => ({
  logAnalysis: vi.fn(),
  logError: vi.fn(),
}));

const STEAM_ID = "76561198000000001";

const profile = buildAggregatedProfile(
  player(),
  [game({ name: "Test Game" })],
  noRecent,
  10,
  [],
  noBadges,
  noAchievements,
);

const cardStats: CardStats = {
  dedication: 91,
  mastery: 42,
  exploration: 17,
  hoarding: 88,
  social: 3,
  veteran: 64,
};

beforeEach(() => {
  process.env.PAYWALL_MODE = "stub";
  cache.clear();
  written.clear();
  cache.set(profileKey(STEAM_ID), profile);
  cache.set(cardStatsKey(STEAM_ID), cardStats);
  cache.set(rarityKey(STEAM_ID), "legendary");
  generatePortrait.mockReset();
  generatePortrait.mockResolvedValue({
    portrait: portraitFixture(),
    provider: "openai",
    model: "test-model",
  });
});

afterEach(() => {
  delete process.env.PAYWALL_MODE;
});

function createRequest(): Request {
  return new Request("https://example.test/api/generate", {
    method: "POST",
    body: JSON.stringify({ steamId64: STEAM_ID, locale: "ru" }),
    headers: { "content-type": "application/json" },
  });
}

/** Ждёт условия, а не времени: фоновая работа заканчивается когда закончится. */
async function waitFor(check: () => boolean, limitMs = 2000): Promise<void> {
  const deadline = Date.now() + limitMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("не дождались");
}

describe("генерация карточки при включённой кассе", () => {
  it("касса stub, входа нет — генерирует, а не отвечает 403", async () => {
    const { POST } = await import("@/app/api/generate/route");

    const res = await POST(createRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.code).not.toBe("ACCESS_REQUIRED");
    // Генерация идёт в фоне, поэтому ждём её, а не проверяем сразу: маршрут
    // отвечает раньше, чем модель начала писать.
    await waitFor(() => written.has(portraitKey(STEAM_ID, "ru")));
    expect(generatePortrait).toHaveBeenCalledTimes(1);
  });

  it("а вот данных разбора нет — по-прежнему DATA_EXPIRED, а не генерация", async () => {
    // Единственный оставшийся ограничитель расхода, кроме лимита по IP:
    // генерировать можно только то, что уже разобрано.
    cache.delete(profileKey(STEAM_ID));
    const { POST } = await import("@/app/api/generate/route");

    const res = await POST(createRequest());
    const body = await res.json();

    expect(res.status).toBe(410);
    expect(body.code).toBe("DATA_EXPIRED");
    expect(generatePortrait).not.toHaveBeenCalled();
  });
});
