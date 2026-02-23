import OpenAI from "openai";
import { CardPortraitSchema, type CardPortrait } from "./types";

function extractJSON(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) return JSON.parse(match[1].trim());
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    throw new Error("No valid JSON found in LLM response");
  }
}

const LOCALE_NAMES: Record<string, string> = {
  ru: "Russian",
  en: "English",
};

export async function translatePortrait(
  portrait: CardPortrait,
  fromLocale: string,
  toLocale: string,
): Promise<CardPortrait | null> {
  try {
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
    });

    const model = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";
    const fromLang = LOCALE_NAMES[fromLocale] || fromLocale;
    const toLang = LOCALE_NAMES[toLocale] || toLocale;

    const systemPrompt = `You are a JSON translator. Translate the following JSON object from ${fromLang} to ${toLang}.

Rules:
- Translate ONLY text string values (names, descriptions, titles, text fields, quotes, lore, etc.)
- DO NOT change: numbers, stat values, hex colors, enum values (rarity, severity, decision_style, social_type), keys, structure
- Keep the same JSON structure exactly
- Return ONLY valid JSON, no markdown, no explanation`;

    const response = await client.chat.completions.create({
      model,
      max_tokens: 5000,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(portrait) },
      ],
    });

    const text = response.choices[0]?.message?.content;
    if (!text) return null;

    const json = extractJSON(text);
    const parsed = CardPortraitSchema.safeParse(json);
    if (parsed.success) {
      console.log(`[translate] Successfully translated portrait from ${fromLocale} to ${toLocale}`);
      return parsed.data;
    }

    console.warn(`[translate] Parse failed, retrying:`, parsed.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`));

    // Retry
    const retry = await client.chat.completions.create({
      model,
      max_tokens: 5000,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(portrait) },
        { role: "assistant", content: text },
        {
          role: "user",
          content: `The JSON was invalid. Errors: ${parsed.error.issues.map((e) => e.message).join(", ")}. Fix and return ONLY valid JSON.`,
        },
      ],
    });

    const retryText = retry.choices[0]?.message?.content;
    if (!retryText) return null;

    const retryParsed = CardPortraitSchema.safeParse(extractJSON(retryText));
    if (retryParsed.success) return retryParsed.data;

    console.error(`[translate] Retry also failed`);
    return null;
  } catch (err) {
    console.error(`[translate] Error:`, err);
    return null;
  }
}
