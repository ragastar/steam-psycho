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

/**
 * Бюджеты ожидания ВЛОЖЕНЫ друг в друга, а не равны между собой:
 *
 *   nginx proxy_read_timeout  180с  (снаружи, не в этом репозитории)
 *    > общий бюджет моста     115с  (обе попытки вместе, DEFAULT_TOTAL_MS)
 *      > одна попытка         110с  (DEFAULT_ATTEMPT_MS)
 *        > дочерний claude    100с  (BRIDGE_TIMEOUT_MS на стороне моста)
 *
 * Нижнее значение измерено, а не выбрано на глаз: боевая карточка на
 * claude-sonnet-5 через мост заняла 77с (5118 токенов вывода). Отсюда 100с
 * дочернему процессу и 65с, которые внутри окна nginx остаются запасному
 * платному ключу.
 *
 * Раньше все три уровня стояли на 180с. Протухшая сессия проявляется тишиной
 * на три минуты, и выглядело это так: посетитель ждёт 180с, nginx отдаёт 504
 * ровно в тот момент, когда код только собрался пойти на запасной платный
 * ключ. То есть запасной поставщик не срабатывал НИ РАЗУ — он был написан,
 * протестирован и мёртв. Хуже того, при неразобранном ответе делается вторая
 * попытка, и потолок становился 360с — вдвое больше окна nginx.
 *
 * Теперь внутри окна nginx гарантированно остаётся ~70с на запасного, и это
 * учитывает обе попытки моста, а не одну.
 */
const DEFAULT_ATTEMPT_MS = 110_000;
const DEFAULT_TOTAL_MS = 115_000;

/**
 * Минимум, при котором вторая попытка вообще имеет смысл. Генерация занимает
 * порядка 77с, поэтому переспрос с остатком меньше 30с — гарантированно
 * потраченное впустую время, которое нужно запасному поставщику.
 *
 * На практике бюджет на переспрос почти всегда есть: неразбираемый ответ
 * (отказ, короткая отписка) возвращается за секунды, а не за минуту. Если же
 * первая попытка молотила долго И выдала мусор — правильный ход именно уйти
 * на платный ключ, а не пробовать второй раз то же самое.
 */
const MIN_RETRY_MS = 30_000;

function attemptBudgetMs(): number {
  return Number(process.env.CLAUDE_BRIDGE_TIMEOUT_MS) || DEFAULT_ATTEMPT_MS;
}

function totalBudgetMs(): number {
  return Number(process.env.CLAUDE_BRIDGE_TOTAL_TIMEOUT_MS) || DEFAULT_TOTAL_MS;
}

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

async function callBridge(
  system: string,
  prompt: string,
  remainingMs: number,
): Promise<BridgeReply> {
  const token = process.env.CLAUDE_BRIDGE_TOKEN?.trim();
  if (!token) throw new BridgeUnavailableError("CLAUDE_BRIDGE_TOKEN не задан");

  const endpoint = process.env.CLAUDE_BRIDGE_ENDPOINT?.trim() || DEFAULT_ENDPOINT;
  // Одна попытка не может длиться дольше того, что осталось от ОБЩЕГО
  // бюджета: иначе две попытки по 70с дали бы 140с и снова выели время
  // запасного поставщика.
  const timeout = Math.min(attemptBudgetMs(), remainingMs);

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
  // Общий срок на обе попытки. Считается от начала, а не заново на каждую:
  // именно поэтому потолок больше не удваивается при переспросе.
  const deadline = Date.now() + totalBudgetMs();

  const first = await callBridge(systemPrompt, userPrompt, deadline - Date.now());
  const parsed = parsePortrait(first.text!);
  if (parsed) return { portrait: parsed, model: first.model || "subscription" };

  const left = deadline - Date.now();
  if (left < MIN_RETRY_MS) {
    throw new BridgeUnavailableError(
      "ответ не разобран, а времени на переспрос не осталось — уходим на запасного",
    );
  }

  const retryPrompt =
    `${userPrompt}\n\nПредыдущий ответ не удалось разобрать. Верни ТОЛЬКО валидный ` +
    `JSON нужной структуры: без пояснений, без markdown-блока, без текста вокруг.`;

  const second = await callBridge(systemPrompt, retryPrompt, left);
  const retried = parsePortrait(second.text!);
  if (retried) return { portrait: retried, model: second.model || "subscription" };

  throw new BridgeUnavailableError("модель дважды вернула неразбираемый ответ");
}
