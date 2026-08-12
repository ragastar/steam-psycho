/**
 * Извлечение JSON из ответа модели.
 *
 * Нужно всем поставщикам, кроме прямого API Anthropic: там формат задан схемой
 * и разбирать нечего. Отдельный модуль, потому что импортировать это из
 * client.ts в поставщика нельзя — client.ts сам импортирует поставщиков,
 * получилось бы кольцо.
 */
export function extractJSON(text: string): unknown {
  const candidates: string[] = [text];

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) candidates.push(fenced[1].trim());

  const braces = text.match(/\{[\s\S]*\}/);
  if (braces) candidates.push(braces[0]);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      try {
        return JSON.parse(escapeRawControlChars(candidate));
      } catch {
        // Следующий кандидат.
      }
    }
  }

  throw new Error("В ответе модели нет JSON");
}

/**
 * Экранирует управляющие символы, оказавшиеся внутри строк JSON.
 *
 * Модель регулярно ставит настоящий перевод строки прямо в значение — по
 * стандарту так нельзя, и разбор падает с «Bad control character in string
 * literal». Ответ при этом целый: обрыва нет, дело только в переносе внутри
 * кавычек. На боевом прогоне так падали одна-две генерации из восьми, а
 * переспросить уже некогда — на него нужен запас в сто секунд, которого при
 * нынешней длине ответа не остаётся. Терять из-за переноса строки готовую
 * карточку, за которую человек заплатил, нельзя.
 *
 * Идём по строке и считаем, находимся ли внутри кавычек; экранируем только
 * то, что попало внутрь. Снаружи переносы законны и трогать их не нужно.
 */
function escapeRawControlChars(input: string): string {
  const ESCAPES: Record<string, string> = { "\n": "\\n", "\r": "\\r", "\t": "\\t", "\b": "\\b", "\f": "\\f" };
  let out = "";
  let inString = false;
  let escaped = false;

  for (const char of input) {
    if (escaped) {
      out += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      out += char;
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      out += char;
      continue;
    }
    if (inString) {
      const known = ESCAPES[char];
      if (known) {
        out += known;
        continue;
      }
      // Прочие управляющие символы (например, вертикальная табуляция) —
      // в шестнадцатеричном виде: выкидывать их значило бы менять текст.
      if (char < " ") {
        out += `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`;
        continue;
      }
    }
    out += char;
  }

  return out;
}
