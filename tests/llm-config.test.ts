import { describe, it, expect, beforeEach } from "vitest";
import { resolveConfig } from "@/lib/llm/client";

const ENV_KEYS = ["LLM_PROVIDER", "OPENROUTER_MODEL", "ANTHROPIC_MODEL", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"];

beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

describe("выбор поставщика и модели (OPS-1, OPS-2)", () => {
  it("OPENROUTER_MODEL влияет на генерацию портрета, а не только на перевод", () => {
    process.env.OPENAI_API_KEY = "k";
    process.env.OPENROUTER_MODEL = "anthropic/claude-sonnet-4.5";
    expect(resolveConfig().model).toBe("anthropic/claude-sonnet-4.5");
  });

  it("при двух ключах по умолчанию идёт через OpenRouter, а не напрямую в Anthropic", () => {
    process.env.OPENAI_API_KEY = "k";
    process.env.ANTHROPIC_API_KEY = "k2";
    expect(resolveConfig().provider).toBe("openai");
  });

  it("явная настройка перебивает угадывание", () => {
    process.env.OPENAI_API_KEY = "k";
    process.env.ANTHROPIC_API_KEY = "k2";
    process.env.LLM_PROVIDER = "anthropic";
    expect(resolveConfig().provider).toBe("anthropic");
  });

  it("падает сразу на неизвестном поставщике, а не в середине генерации", () => {
    process.env.OPENAI_API_KEY = "k";
    process.env.LLM_PROVIDER = "openrouter";
    expect(() => resolveConfig()).toThrow(/неизвестный поставщик/);
  });

  it("падает понятной ошибкой, когда ключей нет вообще", () => {
    expect(() => resolveConfig()).toThrow(/ключ/);
  });
});
