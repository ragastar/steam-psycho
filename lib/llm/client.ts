import OpenAI from "openai";
import type { AggregatedProfile } from "../aggregation/types";
import type { CardPortrait, Rarity } from "./types";
import type { CardStats } from "../aggregation/aggregate";
import { CardPortraitSchema } from "./types";
import { getSystemPrompt, buildUserPrompt } from "./prompt";
import { generateWithAnthropic as generatePortraitViaAnthropic } from "./providers/anthropic";
import { generateWithBridge, BridgeUnavailableError } from "./providers/claude-bridge";
import { extractJSON } from "./json";

export type LLMProvider = "claude-bridge" | "anthropic" | "openai";

export interface LLMConfig {
  provider: LLMProvider;
  model?: string;
}

const DEFAULT_MODELS: Record<LLMProvider, string> = {
  // Модель определяет подписка, своего значения у моста нет.
  "claude-bridge": "subscription",
  // Должно совпадать с DEFAULT_MODEL в providers/anthropic.ts,
  // иначе статистика и админка покажут не ту модель, что отработала.
  anthropic: "claude-opus-5",
  openai: "openai/gpt-4o-mini",
};

const PROVIDERS: LLMProvider[] = ["claude-bridge", "anthropic", "openai"];

/**
 * Раньше поставщик угадывался по наличию ключа, причём Anthropic был
 * приоритетнее. Пример настроек предлагал заполнить оба ключа — и запросы
 * молча уходили напрямую в Anthropic мимо OpenRouter. Теперь выбор явный,
 * а неизвестное значение падает сразу, а не в середине генерации.
 */
export function resolveConfig(provider?: LLMProvider): LLMConfig {
  const fromEnv = process.env.LLM_PROVIDER?.trim();
  if (!provider && fromEnv && !PROVIDERS.includes(fromEnv as LLMProvider)) {
    throw new Error(
      `LLM_PROVIDER="${fromEnv}" — неизвестный поставщик. Допустимо: ${PROVIDERS.join(", ")}`,
    );
  }

  let resolved = provider || (fromEnv as LLMProvider | undefined);
  if (!resolved) {
    // По умолчанию идём через OpenRouter — под него написан весь проект.
    if (process.env.OPENAI_API_KEY) resolved = "openai";
    else if (process.env.ANTHROPIC_API_KEY) resolved = "anthropic";
    else throw new Error("Не задан ни один ключ LLM: нужен OPENAI_API_KEY (OpenRouter) или ANTHROPIC_API_KEY.");
  }

  // OPENROUTER_MODEL раньше читался только в переводчике, а для портрета
  // модель была зашита в коде — смена настройки молча ничего не делала.
  const model =
    resolved === "openai"
      ? process.env.OPENROUTER_MODEL?.trim() || DEFAULT_MODELS.openai
      : resolved === "anthropic"
        ? process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODELS.anthropic
        : DEFAULT_MODELS["claude-bridge"];

  return { provider: resolved, model };
}

// --- Anthropic (Claude) ---
// Реализация вынесена в providers/anthropic.ts: там кеширование системного
// промпта, схема ответа и обработка отказа классификатора.

// --- OpenAI ---

async function generateWithOpenAI(
  profile: AggregatedProfile,
  cardStats: CardStats,
  rarity: Rarity,
  locale: string,
  model: string,
): Promise<CardPortrait> {
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
    timeout: 45_000,
  });

  const response = await client.chat.completions.create({
    model,
    max_tokens: 5000,
    messages: [
      { role: "system", content: getSystemPrompt(locale) },
      { role: "user", content: buildUserPrompt(profile, cardStats, rarity) },
    ],
  });

  const text = response.choices[0]?.message?.content;
  if (!text) throw new Error("No text in OpenAI response");

  const json = extractJSON(text);
  const parsed = CardPortraitSchema.safeParse(json);
  if (parsed.success) return parsed.data;

  console.warn(`[llm] OpenAI parse failed:`, (parsed as { error: { issues: { path: string[]; message: string }[] } }).error.issues.map((e) => `${e.path.join(".")}: ${e.message}`));

  // Retry — wrap in try/catch to avoid doubling timeout
  try {
    const retry = await client.chat.completions.create({
      model,
      max_tokens: 5000,
      messages: [
        { role: "system", content: getSystemPrompt(locale) },
        { role: "user", content: buildUserPrompt(profile, cardStats, rarity) },
        { role: "assistant", content: text },
        {
          role: "user",
          content: `The JSON was invalid. Errors: ${parsed.error.issues.map((e) => e.message).join(", ")}. Fix and return ONLY valid JSON.`,
        },
      ],
    });

    const retryText = retry.choices[0]?.message?.content;
    if (!retryText) throw new Error("No text in retry");
    return CardPortraitSchema.parse(extractJSON(retryText));
  } catch (retryErr) {
    console.error("[llm] OpenAI retry failed:", retryErr instanceof Error ? retryErr.message : retryErr);
    throw new Error("LLM retry failed: " + (retryErr instanceof Error ? retryErr.message : "unknown"));
  }
}

// --- Public API ---

export interface GenerationResult {
  portrait: CardPortrait;
  /** Что реально отработало — статистика раньше писала значение из настроек. */
  provider: LLMProvider;
  model: string;
  /** Расход токенов: позволяет считать реальную стоимость портрета. */
  usage?: { input: number; output: number; cachedInput: number };
}

/**
 * Кого пробовать, когда мост отказал. Порядок: сначала оплачиваемый ключ
 * Anthropic (та же модель, гарантированный формат), потом OpenRouter.
 */
function pickFallback(): LLMProvider | null {
  if (process.env.ANTHROPIC_API_KEY?.trim()) return "anthropic";
  if (process.env.OPENAI_API_KEY?.trim()) return "openai";
  return null;
}

export async function generatePortrait(
  profile: AggregatedProfile,
  cardStats: CardStats,
  rarity: Rarity,
  locale: string,
  provider?: LLMProvider,
): Promise<GenerationResult> {
  const config = resolveConfig(provider);
  const model = config.model!;

  if (config.provider === "claude-bridge") {
    try {
      const result = await generateWithBridge(
        getSystemPrompt(locale),
        buildUserPrompt(profile, cardStats, rarity),
      );
      return { portrait: result.portrait, provider: "claude-bridge", model: result.model };
    } catch (err) {
      // Подменяем запасным только отказ моста. Ошибка в нашем коде должна
      // падать честно, иначе она молча спрячется за счётом за токены.
      if (!(err instanceof BridgeUnavailableError)) throw err;

      const fallback = pickFallback();
      console.warn(`[llm] ${err.message}; ухожу на ${fallback ?? "никого — запасных ключей нет"}`);
      if (!fallback) throw err;

      return generatePortrait(profile, cardStats, rarity, locale, fallback);
    }
  }

  if (config.provider === "anthropic") {
    const result = await generatePortraitViaAnthropic(
      getSystemPrompt(locale),
      buildUserPrompt(profile, cardStats, rarity),
    );
    return {
      portrait: result.portrait,
      provider: "anthropic",
      model: result.model,
      usage: {
        input: result.inputTokens,
        output: result.outputTokens,
        cachedInput: result.cachedInputTokens,
      },
    };
  }

  const portrait = await generateWithOpenAI(profile, cardStats, rarity, locale, model);
  return { portrait, provider: config.provider, model };
}

export function getAvailableProviders(): { id: LLMProvider; name: string; model: string; available: boolean }[] {
  return [
    {
      id: "claude-bridge",
      name: "Claude (подписка через мост)",
      model: DEFAULT_MODELS["claude-bridge"],
      available: !!process.env.CLAUDE_BRIDGE_TOKEN,
    },
    {
      id: "anthropic",
      name: "Claude (Anthropic)",
      model: process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODELS.anthropic,
      available: !!process.env.ANTHROPIC_API_KEY,
    },
    {
      id: "openai",
      name: "GPT (OpenRouter)",
      model: process.env.OPENROUTER_MODEL?.trim() || DEFAULT_MODELS.openai,
      available: !!process.env.OPENAI_API_KEY,
    },
  ];
}
