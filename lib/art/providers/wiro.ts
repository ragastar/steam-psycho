import crypto from "crypto";

/**
 * Клиент Wiro.ai для генерации картинок.
 *
 * Отличается от предыдущего поставщика тем, что работа асинхронная: сначала
 * ставим задачу, потом опрашиваем её статус, и только в конце получаем ссылку
 * на готовый файл.
 */

const BASE_URL = "https://api.wiro.ai/v1";
const DEFAULT_MODEL = "google/nano-banana-2";

// Картинка обычно готова за 10–40 секунд. Ждём не дольше двух минут:
// дальше запрос всё равно оборвётся по таймауту у пользователя.
const POLL_INTERVAL_MS = 5000;
const MAX_WAIT_MS = 120_000;

const DONE = "task_postprocess_end";
const FAILED = new Set(["task_failed", "task_error"]);

interface RunResponse {
  result?: boolean;
  taskid?: string;
  socketaccesstoken?: string;
  errors?: unknown;
}

interface DetailResponse {
  tasklist?: Array<{
    status?: string;
    outputs?: Array<{ url?: string }>;
  }>;
  status?: string;
  outputs?: Array<{ url?: string }>;
}

function credentials(): { key: string; secret: string } | null {
  const key = process.env.WIRO_API_KEY?.trim();
  const secret = process.env.WIRO_API_SECRET?.trim();
  if (!key || !secret) return null;
  return { key, secret };
}

/**
 * Подпись запроса: HMAC-SHA256, где ключом выступает API Key,
 * а подписываемым сообщением — секрет вместе с одноразовым числом.
 */
function authHeaders(key: string, secret: string): Record<string, string> {
  const nonce = Date.now().toString();
  const signature = crypto.createHmac("sha256", key).update(secret + nonce).digest("hex");
  return {
    "x-api-key": key,
    "x-nonce": nonce,
    "x-signature": signature,
  };
}

/** Модели seedream без этих полей отвечают ошибкой 400. */
function extraParams(model: string): Record<string, unknown> {
  if (model.includes("seedream")) {
    return { maxImages: 1, watermark: false };
  }
  return {};
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Ответ приходит в двух формах в зависимости от стадии — нормализуем. */
function readTask(data: DetailResponse): { status: string; url: string | null } {
  const task = data.tasklist?.[0] ?? data;
  return {
    status: task.status ?? "",
    url: task.outputs?.[0]?.url ?? null,
  };
}

/**
 * Ставит задачу и дожидается готовой картинки.
 * Возвращает ссылку на файл в CDN или null, если не получилось.
 */
export async function generateImageUrl(prompt: string): Promise<string | null> {
  const creds = credentials();
  if (!creds) {
    console.error("[wiro] WIRO_API_KEY / WIRO_API_SECRET не заданы");
    return null;
  }

  const model = process.env.WIRO_MODEL?.trim() || DEFAULT_MODEL;

  let token: string;
  try {
    const res = await fetch(`${BASE_URL}/Run/${model}`, {
      method: "POST",
      headers: {
        ...authHeaders(creds.key, creds.secret),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt, ...extraParams(model) }),
    });

    if (!res.ok) {
      console.error(`[wiro] постановка задачи не удалась (${res.status}):`, (await res.text()).slice(0, 300));
      return null;
    }

    const data = (await res.json()) as RunResponse;
    if (!data.socketaccesstoken) {
      console.error("[wiro] в ответе нет socketaccesstoken:", JSON.stringify(data).slice(0, 300));
      return null;
    }
    token = data.socketaccesstoken;
  } catch (err) {
    console.error("[wiro] постановка задачи упала:", err);
    return null;
  }

  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);

    try {
      // Этот эндпоинт принимает форму, а не JSON, и чувствителен к регистру.
      const res = await fetch(`${BASE_URL}/Task/Detail`, {
        method: "POST",
        headers: {
          ...authHeaders(creds.key, creds.secret),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ tasktoken: token }).toString(),
      });

      if (!res.ok) continue;

      const { status, url } = readTask((await res.json()) as DetailResponse);

      if (status === DONE) {
        if (!url) {
          console.error("[wiro] задача завершена, но ссылки на файл нет");
          return null;
        }
        return url;
      }

      if (FAILED.has(status)) {
        console.error(`[wiro] задача завершилась ошибкой: ${status}`);
        return null;
      }
    } catch (err) {
      console.error("[wiro] опрос статуса упал:", err);
    }
  }

  console.error(`[wiro] картинка не готова за ${MAX_WAIT_MS / 1000} с — сдаёмся`);
  return null;
}
