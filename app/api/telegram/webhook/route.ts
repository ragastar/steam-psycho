import { registerHandlers } from "@/lib/telegram/handlers";
import { getBot, ensureBotInit, ensureWebhook } from "@/lib/telegram/bot";

registerHandlers();

export async function POST(req: Request) {
  // Auto-register webhook on first request after container start
  ensureWebhook().catch((err) =>
    console.error("[webhook] ensureWebhook background error:", err),
  );

  // 1. Validate secret token
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== secret) {
    return new Response("Unauthorized", { status: 401 });
  }

  // 2. Parse update
  let update;
  try {
    update = await req.json();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  // 3. Init bot (once) and process in background
  const bot = getBot();
  if (bot) {
    ensureBotInit()
      .then(() => bot.handleUpdate(update))
      .catch((err) => console.error("[webhook] handleUpdate error:", err));
  }

  // 4. Return 200 immediately so Telegram doesn't retry
  return new Response("ok", { status: 200 });
}
