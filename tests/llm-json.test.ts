import { describe, it, expect } from "vitest";
import { extractJSON } from "@/lib/llm/json";

describe("извлечение JSON из ответа модели", () => {
  it("разбирает чистый JSON", () => {
    expect(extractJSON('{"a":1}')).toEqual({ a: 1 });
  });

  it("достаёт JSON из markdown-блока", () => {
    expect(extractJSON('Вот результат:\n```json\n{"a":1}\n```\nГотово')).toEqual({ a: 1 });
  });

  it("достаёт JSON из блока без пометки языка", () => {
    expect(extractJSON('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("достаёт JSON, окружённый болтовнёй", () => {
    expect(extractJSON('Конечно! {"a":1} — надеюсь, помог.')).toEqual({ a: 1 });
  });

  it("бросает понятную ошибку, когда JSON нет", () => {
    expect(() => extractJSON("извини, не могу")).toThrow(/нет JSON/);
  });
});
