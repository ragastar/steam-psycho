import OpenAI from "openai";
import fs from "fs";
import path from "path";

export interface ArtResult {
  imageUrl: string | null;
  prompt: string;
  cached: boolean;
}

// Direct OpenAI API for image generation
const IMAGE_MODEL = "dall-e-3" as const;

// Persistent storage: /data/art in production (Docker volume), local fallback for dev
const ART_DIR = process.env.ART_STORAGE_PATH || path.join(process.cwd(), "data", "art");

export function getArtFilePath(steamId64: string): string {
  return path.join(ART_DIR, `${steamId64}.png`);
}

export function artFileExists(steamId64: string): boolean {
  return fs.existsSync(getArtFilePath(steamId64));
}

export async function generateArtImage(
  steamId64: string,
  imagePrompt: string,
): Promise<ArtResult> {
  // Check if file already exists on disk
  if (artFileExists(steamId64)) {
    return { imageUrl: `/api/art/image/${steamId64}`, prompt: imagePrompt, cached: true };
  }

  const apiKey = process.env.OPENAI_DIRECT_API_KEY;
  if (!apiKey) {
    console.error("Art generation: OPENAI_DIRECT_API_KEY not set");
    return { imageUrl: null, prompt: imagePrompt, cached: false };
  }

  try {
    const client = new OpenAI({ apiKey });

    const response = await client.images.generate({
      model: IMAGE_MODEL,
      prompt: imagePrompt,
      n: 1,
      size: "1024x1024",
      quality: "standard",
      response_format: "b64_json",
    });

    const b64 = response.data?.[0]?.b64_json;
    if (!b64) {
      console.error("Art generation: no image data in response");
      return { imageUrl: null, prompt: imagePrompt, cached: false };
    }

    // Save to persistent storage
    fs.mkdirSync(ART_DIR, { recursive: true });
    fs.writeFileSync(getArtFilePath(steamId64), Buffer.from(b64, "base64"));

    return { imageUrl: `/api/art/image/${steamId64}`, prompt: imagePrompt, cached: false };
  } catch (err) {
    console.error("Art generation failed:", err);
    return { imageUrl: null, prompt: imagePrompt, cached: false };
  }
}
