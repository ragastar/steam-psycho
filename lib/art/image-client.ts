import fs from "fs";
import path from "path";

export interface ArtResult {
  imageUrl: string | null;
  prompt: string;
  cached: boolean;
}

// OpenRouter image generation via chat completions
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const IMAGE_MODEL = "google/gemini-2.5-flash-image";

// Persistent storage: /data/art in production (Docker volume), local fallback for dev
const ART_DIR = process.env.ART_STORAGE_PATH || path.join(process.cwd(), "data", "art");

export function getArtFilePath(steamId64: string): string {
  return path.join(ART_DIR, `${steamId64}.png`);
}

export function artFileExists(steamId64: string): boolean {
  return fs.existsSync(getArtFilePath(steamId64));
}

interface OpenRouterImageResponse {
  choices?: Array<{
    message?: {
      content?: string;
      images?: Array<{
        type: string;
        image_url: { url: string };
      }>;
    };
  }>;
}

export async function generateArtImage(
  steamId64: string,
  imagePrompt: string,
): Promise<ArtResult> {
  // Check if file already exists on disk
  if (artFileExists(steamId64)) {
    return { imageUrl: `/api/art/image/${steamId64}`, prompt: imagePrompt, cached: true };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("Art generation: OPENAI_API_KEY not set");
    return { imageUrl: null, prompt: imagePrompt, cached: false };
  }

  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.NEXT_PUBLIC_BASE_URL || "https://gamertype.fun",
        "X-Title": "GamerType",
      },
      body: JSON.stringify({
        model: IMAGE_MODEL,
        messages: [{ role: "user", content: imagePrompt }],
        modalities: ["image", "text"],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`Art generation failed (${res.status}):`, errText);
      return { imageUrl: null, prompt: imagePrompt, cached: false };
    }

    const data: OpenRouterImageResponse = await res.json();
    const imageDataUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;

    if (!imageDataUrl) {
      console.error("Art generation: no image in response");
      return { imageUrl: null, prompt: imagePrompt, cached: false };
    }

    // Extract base64 from data URL and save to disk
    const base64Match = imageDataUrl.match(/^data:image\/\w+;base64,(.+)$/);
    if (base64Match) {
      fs.mkdirSync(ART_DIR, { recursive: true });
      fs.writeFileSync(getArtFilePath(steamId64), Buffer.from(base64Match[1], "base64"));
    }

    return { imageUrl: `/api/art/image/${steamId64}`, prompt: imagePrompt, cached: false };
  } catch (err) {
    console.error("Art generation failed:", err);
    return { imageUrl: null, prompt: imagePrompt, cached: false };
  }
}
