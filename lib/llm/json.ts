/**
 * Извлечение JSON из ответа модели.
 *
 * Нужно всем поставщикам, кроме прямого API Anthropic: там формат задан схемой
 * и разбирать нечего. Отдельный модуль, потому что импортировать это из
 * client.ts в поставщика нельзя — client.ts сам импортирует поставщиков,
 * получилось бы кольцо.
 */
export function extractJSON(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) return JSON.parse(fenced[1].trim());
    const braces = text.match(/\{[\s\S]*\}/);
    if (braces) return JSON.parse(braces[0]);
    throw new Error("В ответе модели нет JSON");
  }
}
