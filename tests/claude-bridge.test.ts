import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { generateWithBridge, BridgeUnavailableError } from "@/lib/llm/providers/claude-bridge";

/**
 * Минимальная карточка, проходящая CardPortraitSchema.
 *
 * Бриф задачи описывал фикстуру без title/emoji/rarity/spirit_animal/lore/
 * art_mood/art_scene — с тех пор CardPortraitSchema обзавелась этими
 * обязательными полями. Дополнено ими, чтобы фикстура реально проходила
 * актуальную схему; сама генерация из брифа не тронута.
 */
const VALID = {
  primaryArchetype: { name: "Затворник", description: "Играет один", color: "#fff" },
  secondaryArchetype: { name: "Скупщик", description: "Копит скидки", color: "#ccc" },
  shadowArchetype: { name: "Призрак", description: "Заходит раз в год", color: "#333" },
  title: "Затворник библиотеки",
  emoji: "🎮",
  rarity: "rare" as const,
  stats: { dedication: 50, mastery: 40, exploration: 30, hoarding: 90, social: 10, veteran: 70 },
  roasts: Array.from({ length: 6 }, (_, i) => ({
    icon: "🔥", title: `Подкол ${i + 1}`, text: "Текст подкола",
    stat: "hoarding", severity: "epic" as const, source: "библиотека",
  })),
  spirit_game: "Steam",
  spirit_animal: { name: "Сова", description: "Не спит по ночам" },
  lore: "Легенда о библиотеке без единого запуска",
  quote: "Купил, но не сыграл",
  art_mood: "мрачный",
  art_scene: "тёмная комната с экраном",
};

function reply(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

beforeEach(() => {
  process.env.CLAUDE_BRIDGE_TOKEN = "секрет";
  process.env.CLAUDE_BRIDGE_ENDPOINT = "http://мост.local/generate";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.CLAUDE_BRIDGE_TOKEN;
  delete process.env.CLAUDE_BRIDGE_ENDPOINT;
});

describe("поставщик через мост к подписке", () => {
  it("разбирает валидный ответ с первого раза", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply({ text: JSON.stringify(VALID), model: "claude-opus-5" }));
    vi.stubGlobal("fetch", fetchMock);

    const out = await generateWithBridge("система", "запрос");

    expect(out.portrait.primaryArchetype.name).toBe("Затворник");
    expect(out.model).toBe("claude-opus-5");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("достаёт карточку из markdown-блока", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      reply({ text: "Готово:\n```json\n" + JSON.stringify(VALID) + "\n```" }),
    ));

    const out = await generateWithBridge("система", "запрос");
    expect(out.portrait.quote).toBe("Купил, но не сыграл");
    expect(out.model).toBe("subscription");
  });

  it("переспрашивает один раз, если ответ не разобрался", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply({ text: "извини, не могу" }))
      .mockResolvedValueOnce(reply({ text: JSON.stringify(VALID) }));
    vi.stubGlobal("fetch", fetchMock);

    const out = await generateWithBridge("система", "запрос");

    expect(out.portrait.stats.hoarding).toBe(90);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("сдаётся после второго промаха", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({ text: "всё ещё не могу" })));
    await expect(generateWithBridge("система", "запрос")).rejects.toBeInstanceOf(BridgeUnavailableError);
  });

  it("занятый мост превращается в BridgeUnavailableError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({ error: "мост занят" }, 503)));
    await expect(generateWithBridge("система", "запрос")).rejects.toThrow(/недоступен/);
  });

  it("без секрета в сеть не ходит", async () => {
    delete process.env.CLAUDE_BRIDGE_TOKEN;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateWithBridge("система", "запрос")).rejects.toThrow(/TOKEN/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /**
   * Медленный мост: отвечает через delayMs, но честно срывается по сигналу
   * отмены — как настоящий fetch. Без этого потолок нечем проверить: обычный
   * мок отвечает мгновенно, и до отмены дело не доходит.
   */
  function slowReply(body: unknown, delayMs: number) {
    return vi.fn((_url: string, init: RequestInit) => new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(reply(body)), delayMs);
      init.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        const err = new Error("прервано");
        err.name = "AbortError";
        reject(err);
      });
    }));
  }

  it("ждёт карточку дольше двух минут: боевая генерация занимает ~95с", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal("fetch", slowReply({ text: JSON.stringify(VALID) }, 130_000));

      const pending = generateWithBridge("система", "запрос");
      await vi.advanceTimersByTimeAsync(140_000);

      await expect(pending).resolves.toMatchObject({
        portrait: { quote: "Купил, но не сыграл" },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("но не дольше окна nginx: на 170с сдаётся сам", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal("fetch", slowReply({ text: JSON.stringify(VALID) }, 170_000));

      const pending = generateWithBridge("система", "запрос");
      const assertion = expect(pending).rejects.toThrow(/таймаут/);
      await vi.advanceTimersByTimeAsync(175_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("не переспрашивает, когда на вторую генерацию времени уже нет", async () => {
    vi.useFakeTimers();
    try {
      // Мусор пришёл поздно: остатка хватило бы на переспрос по старой мерке
      // (30с), но не на настоящую генерацию — значит переспрашивать нечем.
      const fetchMock = slowReply({ text: "извини, не могу" }, 90_000);
      vi.stubGlobal("fetch", fetchMock);

      const pending = generateWithBridge("система", "запрос");
      const assertion = expect(pending).rejects.toThrow(/времени на переспрос не осталось/);
      await vi.advanceTimersByTimeAsync(100_000);
      await assertion;

      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("системный и пользовательский промпт идут в разные поля", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply({ text: JSON.stringify(VALID) }));
    vi.stubGlobal("fetch", fetchMock);

    await generateWithBridge("СИСТЕМА", "ЗАПРОС");

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ system: "СИСТЕМА", prompt: "ЗАПРОС" });
    expect(fetchMock.mock.calls[0][1].headers["x-bridge-token"]).toBe("секрет");
  });
});
