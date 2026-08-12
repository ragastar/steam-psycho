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

describe("сырые управляющие символы внутри строк", () => {
  it("перевод строки внутри значения не роняет разбор", () => {
    // Живой отказ 2026-08-12: модель поставила настоящий перевод строки внутрь
    // строки JSON («Bad control character in string literal at position 4483»).
    // Ответ при этом целый — обрыва не было. На восьми генерациях так падали
    // одна-две, а переспрос при нынешних сроках уже не помещается.
    const withRawNewline = '{"quote": "первая строка\nвторая строка", "emoji": "🐙"}';
    expect(extractJSON(withRawNewline)).toEqual({ quote: "первая строка\nвторая строка", emoji: "🐙" });
  });

  it("то же внутри markdown-обёртки", () => {
    const fenced = '```json\n{"lore": "жил-был\tзадрот"}\n```';
    expect(extractJSON(fenced)).toEqual({ lore: "жил-был\tзадрот" });
  });

  it("правильный JSON с экранированным переводом строки не портится", () => {
    expect(extractJSON('{"a": "первая\\nвторая"}')).toEqual({ a: "первая\nвторая" });
  });
});
