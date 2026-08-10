import { CardPortraitSchema } from "../types";
import type { CardPortrait } from "../types";
import { extractJSON } from "../json";

/**
 * Генерация карточки через мост к подписке Claude (tools/llm-bridge).
 *
 * В отличие от прямого API, формат ответа схемой НЕ гарантирован: мост отдаёт
 * голый текст. Поэтому вернулись разбор JSON из текста, проверка зодом и один
 * переспрос — та же механика, что на пути OpenRouter.
 */

const DEFAULT_ENDPOINT = "http://host.docker.internal:8788/generate";
const DEFAULT_TIMEOUT_MS = 180_000;

/**
 * Единый тип отказа моста: нет ответа, таймаут, занято, мёртвая сессия,
 * неразбираемый ответ после переспроса. Вызывающий код по нему уходит на
 * запасного поставщика и не разбирает причины.
 */
export class BridgeUnavailableError extends Error {
  constructor(reason: string) {
    super(`Мост к подписке Claude недоступен: ${reason}`);
    this.name = "BridgeUnavailableError";
  }
}

export interface BridgeGeneration {
  portrait: CardPortrait;
  model: string;
}

interface BridgeReply {
  text?: string;
  model?: string;
  error?: string;
}

async function callBridge(system: string, prompt: string): Promise<BridgeReply> {
  const token = process.env.CLAUDE_BRIDGE_TOKEN?.trim();
  if (!token) throw new BridgeUnavailableError("CLAUDE_BRIDGE_TOKEN не задан");

  const endpoint = process.env.CLAUDE_BRIDGE_ENDPOINT?.trim() || DEFAULT_ENDPOINT;
  const timeout = Number(process.env.CLAUDE_BRIDGE_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bridge-token": token },
      body: JSON.stringify({ system, prompt }),
      signal: ctrl.signal,
    });
  } catch (e) {
    const err = e as Error;
    throw new BridgeUnavailableError(
      err.name === "AbortError" ? `таймаут ${Math.round(timeout / 1000)}с` : err.message,
    );
  } finally {
    clearTimeout(timer);
  }

  const data = (await res.json().catch(() => ({}))) as BridgeReply;
  if (!res.ok) throw new BridgeUnavailableError(data.error || `HTTP ${res.status}`);
  if (data.error) throw new BridgeUnavailableError(data.error);
  if (!data.text) throw new BridgeUnavailableError("пустой ответ");
  return data;
}

function parsePortrait(text: string): CardPortrait | null {
  try {
    return CardPortraitSchema.parse(extractJSON(text));
  } catch {
    return null;
  }
}

export async function generateWithBridge(
  systemPrompt: string,
  userPrompt: string,
): Promise<BridgeGeneration> {
  const first = await callBridge(systemPrompt, userPrompt);
  const parsed = parsePortrait(first.text!);
  if (parsed) return { portrait: parsed, model: first.model || "subscription" };

  const retryPrompt =
    `${userPrompt}\n\nПредыдущий ответ не удалось разобрать. Верни ТОЛЬКО валидный ` +
    `JSON нужной структуры: без пояснений, без markdown-блока, без текста вокруг.`;

  const second = await callBridge(systemPrompt, retryPrompt);
  const retried = parsePortrait(second.text!);
  if (retried) return { portrait: retried, model: second.model || "subscription" };

  throw new BridgeUnavailableError("модель дважды вернула неразбираемый ответ");
}
