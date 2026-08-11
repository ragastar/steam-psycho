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
 *    > общий бюджет моста     165с  (обе попытки вместе, DEFAULT_TOTAL_MS)
 *      > одна попытка         160с  (DEFAULT_ATTEMPT_MS)
 *        > дочерний claude    150с  (BRIDGE_TIMEOUT_MS на стороне моста)
 *
 * Потолки подняты 2026-08-11 со 100/110/115 после отказа на живом посетителе.
 * Прежние числа выведены из ОДНОГО замера — 77с, 5118 токенов вывода — с
 * запасом 30%. Запас оказался мал: разбор аккаунта 76561197990915489 занял
 * 93,4с, а следующий прогон того же аккаунта перешагнул 100с, и дочерний
 * процесс убили на полуслове. Разброс времени генерации больше, чем закладывали:
 * длина вывода зависит от библиотеки, и «в среднем 77с» ничего не гарантирует.
 *
 * 150с дочернему процессу — это 60% запаса к худшему наблюдавшемуся прогону,
 * и всё ещё 15с форы до окна nginx. Запасному платному ключу места в бюджете
 * больше нет — его и не было: оба ключа пусты с переезда на новый сервер,
 * решение владельца от 2026-08-11 — жить на одном мосте. Когда ключ появится,
 * бюджеты придётся пересматривать заново: 165 + время платного вызова в 180
 * не влезет, и правильным ответом станет фоновая генерация, а не новые числа.
 *
 * Историческая причина, по которой числа вообще стали маленькими: раньше все
 * три уровня стояли на 180с. Протухшая сессия проявляется тишиной на три
 * минуты, и посетитель ждал 180с, а nginx отдавал 504 ровно в тот момент,
 * когда код только собрался пойти на запасной ключ, — то есть запасной
 * поставщик не срабатывал НИ РАЗУ.
 */
const DEFAULT_ATTEMPT_MS = 160_000;
const DEFAULT_TOTAL_MS = 165_000;

/**
 * Минимум, при котором вторая попытка вообще имеет смысл: переспрос — это
 * ПОЛНАЯ генерация заново, а она занимает под сотню секунд. Прежние 30с
 * выведены из того же устаревшего замера в 77с и обещали переспрос, которого
 * заведомо не хватало: остаток в 40с гарантированно упирался в таймаут, съедал
 * лимит подписки и заставлял посетителя ждать впустую.
 *
 * На практике бюджет на переспрос почти всегда есть: неразбираемый ответ
 * (отказ, короткая отписка) возвращается за секунды, а не за минуту. Если же
 * первая попытка молотила долго И выдала мусор — честнее сразу признать отказ.
 */
const MIN_RETRY_MS = 100_000;

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
