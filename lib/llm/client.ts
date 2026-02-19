import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { AggregatedProfile } from "../aggregation/types";
import type { Portrait } from "./types";
import { PortraitSchema } from "./types";
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

// --- Извлечение JSON ---

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
  locale: string,
  model: string,
): Promise<Portrait> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await client.messages.create({
    model,
    max_tokens: 2000,
    system: getSystemPrompt(locale),
    messages: [{ role: "user", content: buildUserPrompt(profile) }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text in Anthropic response");
  }

  const json = extractJSON(textBlock.text);
  const parsed = PortraitSchema.safeParse(json);
  if (parsed.success) return parsed.data;

  // Retry
  const retry = await client.messages.create({
    model,
    max_tokens: 2000,
    system: getSystemPrompt(locale),
    messages: [
      { role: "user", content: buildUserPrompt(profile) },
      { role: "assistant", content: textBlock.text },
      {
        role: "user",
        content: `The JSON was invalid. Errors: ${parsed.error.issues.map((e) => e.message).join(", ")}. Fix and return ONLY valid JSON.`,
      },
    ],
  });

  const retryText = retry.content.find((b) => b.type === "text");
  if (!retryText || retryText.type !== "text") throw new Error("No text in retry");
  return PortraitSchema.parse(extractJSON(retryText.text));
}

// --- OpenAI ---

async function generateWithOpenAI(
  profile: AggregatedProfile,
  locale: string,
  model: string,
): Promise<Portrait> {
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
  });

  const response = await client.chat.completions.create({
    model,
    max_tokens: 2000,
    messages: [
      { role: "system", content: getSystemPrompt(locale) },
      { role: "user", content: buildUserPrompt(profile) },
    ],
  });

  const text = response.choices[0]?.message?.content;
  if (!text) throw new Error("No text in OpenAI response");

  const json = extractJSON(text);
  const parsed = PortraitSchema.safeParse(json);
  if (parsed.success) return parsed.data;

  // Retry
  const retry = await client.chat.completions.create({
    model,
    max_tokens: 2000,
    messages: [
      { role: "system", content: getSystemPrompt(locale) },
      { role: "user", content: buildUserPrompt(profile) },
      { role: "assistant", content: text },
      {
        role: "user",
        content: `The JSON was invalid. Errors: ${parsed.error.issues.map((e) => e.message).join(", ")}. Fix and return ONLY valid JSON.`,
      },
    ],
  });

  const retryText = retry.choices[0]?.message?.content;
  if (!retryText) throw new Error("No text in retry");
  return PortraitSchema.parse(extractJSON(retryText));
}

// --- Public API ---

export async function generatePortrait(
  profile: AggregatedProfile,
  locale: string,
  provider?: LLMProvider,
): Promise<Portrait> {
  const config = resolveConfig(provider);

  switch (config.provider) {
    case "anthropic":
      return generateWithAnthropic(profile, locale, config.model!);
    case "openai":
      return generateWithOpenAI(profile, locale, config.model!);
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
