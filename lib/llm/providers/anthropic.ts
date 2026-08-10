import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { CardPortraitSchema } from "../types";
import type { CardPortrait } from "../types";

/**
 * Генерация портрета через официальный API Anthropic.
 *
 * Отличия от прежнего пути через OpenRouter:
 *  - системный промпт кешируется (он одинаковый для всех запросов);
 *  - формат ответа задан схемой, поэтому повторный запрос «переделай JSON»
 *    больше не нужен — раньше каждый сбой разбора стоил вторую генерацию;
 *  - отказ модели по правилам безопасности обрабатывается явно.
 */

const DEFAULT_MODEL = "claude-opus-5";
const DEFAULT_EFFORT = "medium";

// Модель думает и пишет ответ из одного бюджета, поэтому запас нужен
// с обеих сторон: сам портрет — это несколько тысяч токенов JSON.
const MAX_TOKENS = 16000;

/**
 * Структурированный вывод не принимает ограничения вроде minItems или
 * maxLength. Схему чистим, а сами ограничения всё равно проверяем зодом
 * после ответа — там они никуда не делись.
 */
const UNSUPPORTED_KEYWORDS = [
  "minItems", "maxItems", "uniqueItems",
  "minLength", "maxLength", "pattern",
  "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
  "minProperties", "maxProperties",
];

function stripUnsupported(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripUnsupported);
  if (node === null || typeof node !== "object") return node;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (UNSUPPORTED_KEYWORDS.includes(key)) continue;
    out[key] = stripUnsupported(value);
  }
  return out;
}

// Схема одна и та же для всех запросов — считаем один раз.
let cachedSchema: Record<string, unknown> | null = null;

export function portraitJsonSchema(): Record<string, unknown> {
  if (!cachedSchema) {
    cachedSchema = stripUnsupported(
      z.toJSONSchema(CardPortraitSchema, { io: "output" }),
    ) as Record<string, unknown>;
  }
  return cachedSchema;
}

/** Модель отказалась отвечать по правилам безопасности. */
export class PortraitRefusedError extends Error {
  constructor(public readonly category: string | null) {
    super(`Модель отказалась генерировать портрет (${category ?? "без категории"})`);
    this.name = "PortraitRefusedError";
  }
}

export interface AnthropicGeneration {
  portrait: CardPortrait;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}

export async function generateWithAnthropic(
  systemPrompt: string,
  userPrompt: string,
): Promise<AnthropicGeneration> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY не задан");

  const model = process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
  const effort = process.env.ANTHROPIC_EFFORT?.trim() || DEFAULT_EFFORT;

  const client = new Anthropic({ apiKey, timeout: 180_000 });

  const response = await client.beta.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    // Промпт одинаковый на каждый запрос — помечаем к кешированию.
    // Повторное чтение стоит примерно вдесятеро дешевле обычного ввода.
    system: [
      { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: userPrompt }],
    output_config: {
      effort: effort as "low" | "medium" | "high" | "xhigh" | "max",
      format: { type: "json_schema", schema: portraitJsonSchema() },
    },
    // Промпт намеренно грубый, поэтому отказ классификатора реален.
    // Запасная модель подхватывает такой запрос в этом же вызове.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });

  // Проверяем ДО чтения content: при отказе он пустой либо оборванный.
  if (response.stop_reason === "refusal") {
    throw new PortraitRefusedError(response.stop_details?.category ?? null);
  }

  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") {
    throw new Error("В ответе Anthropic нет текста");
  }

  // Формат гарантирован схемой, но ограничения вроде «5-6 роастов»
  // структурированный вывод не проверяет — это делает зод.
  const portrait = CardPortraitSchema.parse(JSON.parse(text.text));

  return {
    portrait,
    model: response.model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cachedInputTokens: response.usage.cache_read_input_tokens ?? 0,
  };
}
