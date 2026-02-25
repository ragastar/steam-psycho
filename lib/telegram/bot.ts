import { Bot } from "grammy";

let bot: Bot | null = null;
let botInitPromise: Promise<void> | null = null;
let webhookChecked = false;

export function getBot(): Bot | null {
  if (bot) return bot;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  bot = new Bot(token, {
    client: { timeoutSeconds: 10 },
  });
  return bot;
}

/** Ensure bot.init() has been called (fetches botInfo from Telegram API once) */
export async function ensureBotInit(): Promise<void> {
  const b = getBot();
  if (!b) return;
  if (!botInitPromise) {
    botInitPromise = b.init();
  }
  await botInitPromise;
}

export async function ensureWebhook(): Promise<void> {
  if (webhookChecked) return;
  webhookChecked = true;

  const b = getBot();
  if (!b) return;

  const domain = process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_URL;
  if (!domain) {
    console.warn("[telegram] No NEXT_PUBLIC_SITE_URL set, skipping webhook check");
    return;
  }

  const expectedUrl = `${domain.replace(/\/$/, "")}/api/telegram/webhook`;

  try {
    const info = await b.api.getWebhookInfo();
    if (info.url === expectedUrl) {
      console.log("[telegram] Webhook already set:", expectedUrl);
      return;
    }

    console.log("[telegram] Setting webhook:", expectedUrl, "(was:", info.url || "none", ")");
    await b.api.setWebhook(expectedUrl, {
      secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
    });
    console.log("[telegram] Webhook set successfully");
  } catch (err) {
    console.error("[telegram] ensureWebhook failed:", err instanceof Error ? err.message : err);
    // Don't block — webhook might already be correct
  }
}
