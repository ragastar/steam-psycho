import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const bridgeMock = vi.hoisted(() => vi.fn());
const anthropicMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/llm/providers/claude-bridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/llm/providers/claude-bridge")>();
  return { ...actual, generateWithBridge: bridgeMock };
});

vi.mock("@/lib/llm/providers/anthropic", () => ({
  generateWithAnthropic: anthropicMock,
  PortraitRefusedError: class extends Error {},
}));

// Сборка промптов лезет глубоко в профиль, а здесь проверяется только выбор
// поставщика — настоящий профиль ради этого собирать незачем.
vi.mock("@/lib/llm/prompt", () => ({
  getSystemPrompt: () => "системный промпт",
  buildUserPrompt: () => "пользовательский промпт",
}));

import { generatePortrait, resolveConfig } from "@/lib/llm/client";
import { BridgeUnavailableError } from "@/lib/llm/providers/claude-bridge";
import type { AggregatedProfile } from "@/lib/aggregation/types";
import type { CardStats } from "@/lib/aggregation/aggregate";

const ENV_KEYS = ["LLM_PROVIDER", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "CLAUDE_BRIDGE_TOKEN"];
const profile = {} as AggregatedProfile;
const cardStats = {} as CardStats;
const portrait = { quote: "заглушка" } as never;

beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  bridgeMock.mockReset();
  anthropicMock.mockReset();
});

afterEach(() => vi.restoreAllMocks());

describe("мост как основной поставщик", () => {
  it("claude-bridge — допустимое значение настройки", () => {
    process.env.LLM_PROVIDER = "claude-bridge";
    expect(resolveConfig().provider).toBe("claude-bridge");
  });

  it("не требует ключей: у моста своя авторизация", () => {
    process.env.LLM_PROVIDER = "claude-bridge";
    expect(() => resolveConfig()).not.toThrow();
  });

  it("успешный мост отдаёт карточку и себя как поставщика", async () => {
    process.env.LLM_PROVIDER = "claude-bridge";
    bridgeMock.mockResolvedValue({ portrait, model: "claude-opus-5" });

    const out = await generatePortrait(profile, cardStats, "rare", "ru");

    expect(out.provider).toBe("claude-bridge");
    expect(out.model).toBe("claude-opus-5");
    expect(anthropicMock).not.toHaveBeenCalled();
  });

  it("отказ моста уводит на оплачиваемый ключ, и это видно в результате", async () => {
    process.env.LLM_PROVIDER = "claude-bridge";
    process.env.ANTHROPIC_API_KEY = "ключ";
    bridgeMock.mockRejectedValue(new BridgeUnavailableError("мост занят"));
    anthropicMock.mockResolvedValue({
      portrait, model: "claude-opus-5", inputTokens: 10, outputTokens: 20, cachedInputTokens: 0,
    });

    const out = await generatePortrait(profile, cardStats, "rare", "ru");

    expect(out.provider).toBe("anthropic");
    expect(anthropicMock).toHaveBeenCalledOnce();
  });

  it("без запасных ключей отказ моста доходит до вызывающего", async () => {
    process.env.LLM_PROVIDER = "claude-bridge";
    bridgeMock.mockRejectedValue(new BridgeUnavailableError("сессия протухла"));

    await expect(generatePortrait(profile, cardStats, "rare", "ru"))
      .rejects.toBeInstanceOf(BridgeUnavailableError);
  });

  it("ошибка не от моста не подменяется запасным — падаем честно", async () => {
    process.env.LLM_PROVIDER = "claude-bridge";
    process.env.ANTHROPIC_API_KEY = "ключ";
    bridgeMock.mockRejectedValue(new Error("ошибка в коде"));

    await expect(generatePortrait(profile, cardStats, "rare", "ru")).rejects.toThrow("ошибка в коде");
    expect(anthropicMock).not.toHaveBeenCalled();
  });
});
