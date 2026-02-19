import { Bot, webhookCallback } from "grammy";

let bot: Bot | null = null;

export function getBot(): Bot | null {
  if (bot) return bot;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  bot = new Bot(token);
  return bot;
}

export function getWebhookCb() {
  const b = getBot();
  if (!b) throw new Error("TELEGRAM_BOT_TOKEN not set");
  return webhookCallback(b, "std/http", {
    secretToken: process.env.TELEGRAM_WEBHOOK_SECRET,
  });
}
