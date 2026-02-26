import type { Api } from "grammy";
import { InlineKeyboard } from "grammy";
import { getBot } from "./bot";
import { getCache, setCache } from "@/lib/cache/redis";
import { CACHE_TTL, gateTokenKey } from "@/lib/cache/keys";
import { logGateEvent } from "@/lib/analytics/db";

interface GateData {
  steamId64: string;
  locale: string;
  status: "pending" | "unlocked";
}

async function checkSubscription(
  api: Api,
  channelId: string | number,
  userId: number,
): Promise<boolean> {
  const member = await api.getChatMember(channelId, userId);
  if (["member", "administrator", "creator"].includes(member.status)) return true;

  // Telegram may cache "left" for 1-2s after subscribing — retry once
  await new Promise((r) => setTimeout(r, 1000));
  const retry = await api.getChatMember(channelId, userId);
  return ["member", "administrator", "creator"].includes(retry.status);
}

const WELCOME = `🎮 GamerType — AI-психоанализ по библиотеке Steam.

Что делаю:
→ Подтверждаю подписку на @gamertyper
→ Разблокирую твою карточку

Как получить карточку:
1. Заходи на gamertype.fun
2. Вставь ссылку на Steam-профиль
3. Подпишись на @gamertyper
4. Получи результат!

Канал: @gamertyper
Сайт: gamertype.fun`;

const MESSAGES = {
  ru: {
    unlocked: "✅ Портрет открыт! Вернись на сайт — он уже обновился.",
    notSubscribed: "Сначала подпишись на канал @gamertyper, а потом нажми кнопку ниже.",
    checkButton: "Я подписался ✅",
    expired: "Ссылка устарела. Открой портрет на сайте заново.",
    error: "Что-то пошло не так. Попробуй ещё раз.",
  },
  en: {
    unlocked: "✅ Portrait unlocked! Go back to the site — it's already updated.",
    notSubscribed: "Subscribe to @gamertyper first, then tap the button below.",
    checkButton: "I've subscribed ✅",
    expired: "This link has expired. Open your portrait on the site again.",
    error: "Something went wrong. Please try again.",
  },
} as const;

let handlersRegistered = false;

export function registerHandlers() {
  if (handlersRegistered) return;
  const bot = getBot();
  if (!bot) return;
  handlersRegistered = true;

  bot.command("start", async (ctx) => {
    const token = ctx.match?.trim();
    if (!token) {
      console.log("[gate] /start without token, showing WELCOME");
      await ctx.reply(WELCOME);
      return;
    }

    console.log("[gate] /start with token:", token.slice(0, 8) + "...", "user:", ctx.from?.id);
    await handleGateCheck(ctx.api, ctx.from!.id, token, (text, opts) => ctx.reply(text, opts));
  });

  // Inline button "I've subscribed" callback
  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    if (!data.startsWith("check:")) return;

    const token = data.slice("check:".length);
    console.log("[gate] callback check, token:", token.slice(0, 8) + "...", "user:", ctx.from?.id);

    await handleGateCheck(ctx.api, ctx.from!.id, token, async (text, opts) => {
      // Edit original message instead of sending a new one
      try {
        await ctx.editMessageText(text, opts);
      } catch {
        // If edit fails (e.g. message unchanged), just answer callback
      }
    });
    await ctx.answerCallbackQuery();
  });
}

async function handleGateCheck(
  api: Api,
  userId: number,
  token: string,
  reply: (text: string, opts?: { reply_markup?: InlineKeyboard }) => Promise<unknown>,
) {
  const data = await getCache<GateData>(gateTokenKey(token));
  const locale = data?.locale === "en" ? "en" : "ru";
  const msg = MESSAGES[locale];

  if (!data) {
    console.log("[gate] token not found (expired/missing):", token.slice(0, 8) + "...");
    await reply(msg.expired);
    return;
  }

  if (data.status === "unlocked") {
    console.log("[gate] token already unlocked:", token.slice(0, 8) + "...");
    await reply(msg.unlocked);
    return;
  }

  const channelId = process.env.TELEGRAM_CHANNEL_ID || "@gamertyper";
  try {
    const isSubscribed = await checkSubscription(api, channelId, userId);

    if (isSubscribed) {
      await setCache(gateTokenKey(token), { ...data, status: "unlocked" }, CACHE_TTL.gate);
      logGateEvent({ steamId64: data.steamId64, event: "unlocked" });
      console.log("[gate] UNLOCKED for user:", userId, "steam:", data.steamId64);
      await reply(msg.unlocked);
    } else {
      logGateEvent({ steamId64: data.steamId64, event: "not_subscribed" });
      console.log("[gate] NOT subscribed, user:", userId);
      const keyboard = new InlineKeyboard().text(msg.checkButton, `check:${token}`);
      await reply(msg.notSubscribed, { reply_markup: keyboard });
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[gate] Subscription check failed:", channelId, "user:", userId, "error:", errMsg);

    if (errMsg.includes("bot is not a member") || errMsg.includes("chat not found") || errMsg.includes("CHAT_ADMIN_REQUIRED") || errMsg.includes("member list is inaccessible")) {
      console.error("[gate] CRITICAL: Bot cannot check channel membership. Add bot as admin to", channelId);
      await setCache(gateTokenKey(token), { ...data, status: "unlocked" }, CACHE_TTL.gate);
      logGateEvent({ steamId64: data.steamId64, event: "unlocked" });
      await reply(msg.unlocked);
    } else {
      await reply(msg.error);
    }
  }
}
