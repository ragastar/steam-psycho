import fs from "fs";
import path from "path";
import { generateImageUrl } from "./providers/wiro";

export interface ArtResult {
  imageUrl: string | null;
  prompt: string;
  cached: boolean;
}

// Persistent storage: /data/art в проде (том Docker), локальная папка в разработке
const ART_DIR = process.env.ART_STORAGE_PATH || path.join(process.cwd(), "data", "art");

// Картинка карточки — около мегабайта. Больше пары мегабайт быть не должно,
// и принимать что-то большое с чужого CDN на диск не стоит.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export function getArtFilePath(steamId64: string): string {
  return path.join(ART_DIR, `${steamId64}.png`);
}

export function artFileExists(steamId64: string): boolean {
  return fs.existsSync(getArtFilePath(steamId64));
}

async function downloadToDisk(url: string, filePath: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`[art] скачивание не удалось (${res.status})`);
      return false;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength === 0) {
      console.error("[art] пришёл пустой файл");
      return false;
    }
    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      console.error(`[art] файл слишком большой: ${buffer.byteLength} байт`);
      return false;
    }

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, buffer);
    return true;
  } catch (err) {
    console.error("[art] скачивание упало:", err);
    return false;
  }
}

export async function generateArtImage(
  steamId64: string,
  imagePrompt: string,
): Promise<ArtResult> {
  // Уже сгенерированное лежит на диске — второй раз не платим.
  if (artFileExists(steamId64)) {
    return { imageUrl: `/api/art/image/${steamId64}`, prompt: imagePrompt, cached: true };
  }

  const t0 = Date.now();
  const remoteUrl = await generateImageUrl(imagePrompt);
  if (!remoteUrl) {
    return { imageUrl: null, prompt: imagePrompt, cached: false };
  }

  // Кладём файл к себе: ссылка в CDN поставщика живёт не вечно.
  const saved = await downloadToDisk(remoteUrl, getArtFilePath(steamId64));
  console.log(`[art] ${steamId64} картинка за ${Date.now() - t0}ms, сохранена: ${saved}`);

  if (!saved) {
    return { imageUrl: null, prompt: imagePrompt, cached: false };
  }

  return { imageUrl: `/api/art/image/${steamId64}`, prompt: imagePrompt, cached: false };
}
