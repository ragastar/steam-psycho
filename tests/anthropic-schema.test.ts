import { describe, it, expect } from "vitest";
import { portraitJsonSchema } from "@/lib/llm/providers/anthropic";

/**
 * Схема ответа собирается из зод-описания автоматически. Если обновление zod
 * изменит форму вывода, структурированный вывод молча перестанет приниматься —
 * эти проверки ловят такое до продакшена.
 */

const UNSUPPORTED = [
  "minItems", "maxItems", "uniqueItems",
  "minLength", "maxLength", "pattern",
  "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
  "minProperties", "maxProperties",
];

function walk(node: unknown, visit: (obj: Record<string, unknown>) => void): void {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, visit));
  if (node === null || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  visit(obj);
  Object.values(obj).forEach((v) => walk(v, visit));
}

describe("схема портрета для структурированного вывода", () => {
  const schema = portraitJsonSchema();

  it("не содержит ограничений, которые Anthropic не принимает", () => {
    const found: string[] = [];
    walk(schema, (obj) => {
      for (const key of UNSUPPORTED) if (key in obj) found.push(key);
    });
    expect(found).toEqual([]);
  });

  it("у каждого объекта закрыты лишние поля", () => {
    const open: string[] = [];
    walk(schema, (obj) => {
      if (obj.type === "object" && obj.additionalProperties !== false) {
        open.push(JSON.stringify(obj).slice(0, 60));
      }
    });
    expect(open).toEqual([]);
  });

  it("описывает ожидаемые поля портрета", () => {
    const props = schema.properties as Record<string, unknown>;
    for (const key of ["primaryArchetype", "roasts", "stats", "spirit_animal", "quote"]) {
      expect(props).toHaveProperty(key);
    }
  });

  it("считается один раз и переиспользуется", () => {
    expect(portraitJsonSchema()).toBe(schema);
  });
});
