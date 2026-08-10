import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";

const KEY = "test-key";
const SECRET = "test-secret";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  process.env.WIRO_API_KEY = KEY;
  process.env.WIRO_API_SECRET = SECRET;
  delete process.env.WIRO_MODEL;
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
});

/** Прогоняет промис вместе с таймерами опроса. */
async function runWithTimers<T>(p: Promise<T>): Promise<T> {
  const settled = p.then(
    (v) => ({ ok: true as const, v }),
    (e) => ({ ok: false as const, e }),
  );
  for (let i = 0; i < 40; i++) {
    await vi.advanceTimersByTimeAsync(5000);
  }
  const r = await settled;
  if (!r.ok) throw r.e;
  return r.v;
}

describe("генерация картинки через Wiro", () => {
  it("подписывает запрос так, как ждёт Wiro", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ socketaccesstoken: "tok" }));
    fetchMock.mockResolvedValue(
      jsonResponse({ tasklist: [{ status: "task_postprocess_end", outputs: [{ url: "https://cdn/x.png" }] }] }),
    );

    const { generateImageUrl } = await import("@/lib/art/providers/wiro");
    await runWithTimers(generateImageUrl("кот в короне"));

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    const expected = crypto
      .createHmac("sha256", KEY)
      .update(SECRET + headers["x-nonce"])
      .digest("hex");

    expect(headers["x-api-key"]).toBe(KEY);
    expect(headers["x-signature"]).toBe(expected);
  });

  it("дожидается готовности и отдаёт ссылку на файл", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ socketaccesstoken: "tok" }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ tasklist: [{ status: "task_assign" }] }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ tasklist: [{ status: "task_postprocess_start" }] }));
    fetchMock.mockResolvedValue(
      jsonResponse({ tasklist: [{ status: "task_postprocess_end", outputs: [{ url: "https://cdn/ready.png" }] }] }),
    );

    const { generateImageUrl } = await import("@/lib/art/providers/wiro");
    expect(await runWithTimers(generateImageUrl("дракон"))).toBe("https://cdn/ready.png");
  });

  it("опрашивает статус формой, а не JSON", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ socketaccesstoken: "tok" }));
    fetchMock.mockResolvedValue(
      jsonResponse({ tasklist: [{ status: "task_postprocess_end", outputs: [{ url: "https://cdn/x.png" }] }] }),
    );

    const { generateImageUrl } = await import("@/lib/art/providers/wiro");
    await runWithTimers(generateImageUrl("тест"));

    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toContain("/Task/Detail");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(init.body).toBe("tasktoken=tok");
  });

  it("добавляет обязательные поля моделям seedream", async () => {
    process.env.WIRO_MODEL = "bytedance/seedream-v5-lite";
    fetchMock.mockResolvedValueOnce(jsonResponse({ socketaccesstoken: "tok" }));
    fetchMock.mockResolvedValue(
      jsonResponse({ tasklist: [{ status: "task_postprocess_end", outputs: [{ url: "https://cdn/x.png" }] }] }),
    );

    const { generateImageUrl } = await import("@/lib/art/providers/wiro");
    await runWithTimers(generateImageUrl("тест"));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.maxImages).toBe(1);
    expect(body.watermark).toBe(false);
  });

  it("возвращает null, если задача упала", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ socketaccesstoken: "tok" }));
    fetchMock.mockResolvedValue(jsonResponse({ tasklist: [{ status: "task_failed" }] }));

    const { generateImageUrl } = await import("@/lib/art/providers/wiro");
    expect(await runWithTimers(generateImageUrl("тест"))).toBeNull();
  });

  it("не ходит в сеть без ключей", async () => {
    delete process.env.WIRO_API_KEY;
    delete process.env.WIRO_API_SECRET;

    const { generateImageUrl } = await import("@/lib/art/providers/wiro");
    expect(await generateImageUrl("тест")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
