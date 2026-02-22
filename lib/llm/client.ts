import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { AggregatedProfile } from "../aggregation/types";
import type { CardPortrait, Rarity } from "./types";
import type { CardStats } from "../aggregation/aggregate";
import { CardPortraitSchema } from "./types";
import { getSystemPrompt, buildUserPrompt } from "./prompt";

export type LLMProvider = "anthropic" | "openai";

export interface LLMConfig {
  provider: LLMProvider;
  model?: string;
}

const DEFAULT_MODELS: Record<LLMProvider, string> = {
  anthropic: "claude-sonnet-4-20250514",
  openai: "openai/gpt-4o-mini",
};

function getAvailableProvider(): LLMProvider {
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENAI_API_KEY) return "openai";
  throw new Error("No LLM API key configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.");
}

function resolveConfig(provider?: LLMProvider): LLMConfig {
  const resolved = provider || (process.env.LLM_PROVIDER as LLMProvider) || getAvailableProvider();
  return {
    provider: resolved,
    model: DEFAULT_MODELS[resolved],
  };
}

// --- JSON extraction ---

function extractJSON(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) return JSON.parse(match[1].trim());
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    throw new Error("No valid JSON found in LLM response");
  }
}

// --- Anthropic (Claude) ---

async function generateWithAnthropic(
  profile: AggregatedProfile,
  cardStats: CardStats,
  rarity: Rarity,
  locale: string,
  model: string,
): Promise<CardPortrait> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await client.messages.create({
    model,
    max_tokens: 4000,
    system: getSystemPrompt(locale),
    messages: [{ role: "user", content: buildUserPrompt(profile, cardStats, rarity) }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text in Anthropic response");
  }

  const json = extractJSON(textBlock.text);
  const parsed = CardPortraitSchema.safeParse(json);
  if (parsed.success) return parsed.data;

  // Retry
  const retry = await client.messages.create({
    model,
    max_tokens: 4000,
    system: getSystemPrompt(locale),
    messages: [
      { role: "user", content: buildUserPrompt(profile, cardStats, rarity) },
      { role: "assistant", content: textBlock.text },
      {
        role: "user",
        content: `The JSON was invalid. Errors: ${parsed.error.issues.map((e) => e.message).join(", ")}. Fix and return ONLY valid JSON.`,
      },
    ],
  });

  const retryText = retry.content.find((b) => b.type === "text");
  if (!retryText || retryText.type !== "text") throw new Error("No text in retry");
  return CardPortraitSchema.parse(extractJSON(retryText.text));
}

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
  });

  const response = await client.chat.completions.create({
    model,
    max_tokens: 4000,
    messages: [
      { role: "system", content: getSystemPrompt(locale) },
      { role: "user", content: buildUserPrompt(profile, cardStats, rarity) },
    ],
  });

  const text = response.choices[0]?.message?.content;
  if (!text) throw new Error("No text in OpenAI response");

  const json = extractJSON(text) as Record<string, unknown>;
  console.log(`[llm] OpenAI raw creature: "${json?.creature}", element: "${json?.element}"`);
  const parsed = CardPortraitSchema.safeParse(json);
  if (parsed.success) return parsed.data;

  console.warn(`[llm] OpenAI parse failed:`, parsed.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`));

  // Retry
  const retry = await client.chat.completions.create({
    model,
    max_tokens: 4000,
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
}

// --- Public API ---

export async function generatePortrait(
  profile: AggregatedProfile,
  cardStats: CardStats,
  rarity: Rarity,
  locale: string,
  provider?: LLMProvider,
): Promise<CardPortrait> {
  const config = resolveConfig(provider);

  switch (config.provider) {
    case "anthropic":
      return generateWithAnthropic(profile, cardStats, rarity, locale, config.model!);
    case "openai":
      return generateWithOpenAI(profile, cardStats, rarity, locale, config.model!);
    default:
      throw new Error(`Unknown LLM provider: ${config.provider}`);
  }
}

export function getAvailableProviders(): { id: LLMProvider; name: string; model: string; available: boolean }[] {
  return [
    {
      id: "anthropic",
      name: "Claude (Anthropic)",
      model: DEFAULT_MODELS.anthropic,
      available: !!process.env.ANTHROPIC_API_KEY,
    },
    {
      id: "openai",
      name: "GPT (OpenAI)",
      model: DEFAULT_MODELS.openai,
      available: !!process.env.OPENAI_API_KEY,
    },
  ];
}
