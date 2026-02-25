import type { Api } from "grammy";
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
    notSubscribed: "Сначала подпишись на канал @gamertyper, а потом нажми /start снова.",
    expired: "Ссылка устарела. Открой портрет на сайте заново.",
    error: "Что-то пошло не так. Попробуй ещё раз.",
  },
  en: {
    unlocked: "✅ Portrait unlocked! Go back to the site — it's already updated.",
    notSubscribed: "Subscribe to @gamertyper first, then press /start again.",
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

    const data = await getCache<GateData>(gateTokenKey(token));
    const locale = data?.locale === "en" ? "en" : "ru";
    const msg = MESSAGES[locale];

    if (!data) {
      console.log("[gate] token not found (expired/missing):", token.slice(0, 8) + "...");
      await ctx.reply(msg.expired);
      return;
    }

    if (data.status === "unlocked") {
      console.log("[gate] token already unlocked:", token.slice(0, 8) + "...");
      await ctx.reply(msg.unlocked);
      return;
    }

    const channelId = process.env.TELEGRAM_CHANNEL_ID || "@gamertyper";
    try {
      const isSubscribed = await checkSubscription(ctx.api, channelId, ctx.from!.id);

      if (isSubscribed) {
        await setCache(gateTokenKey(token), { ...data, status: "unlocked" }, CACHE_TTL.gate);
        logGateEvent({ steamId64: data.steamId64, event: "unlocked" });
        console.log("[gate] UNLOCKED for user:", ctx.from?.id, "steam:", data.steamId64);
        await ctx.reply(msg.unlocked);
      } else {
        logGateEvent({ steamId64: data.steamId64, event: "not_subscribed" });
        console.log("[gate] NOT subscribed, user:", ctx.from?.id);
        await ctx.reply(msg.notSubscribed);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[gate] Subscription check failed:", channelId, "user:", ctx.from?.id, "error:", errMsg);

      // Bot is likely not an admin of the channel — unlock gracefully and log
      if (errMsg.includes("bot is not a member") || errMsg.includes("chat not found") || errMsg.includes("CHAT_ADMIN_REQUIRED") || errMsg.includes("member list is inaccessible")) {
        console.error("[gate] CRITICAL: Bot cannot check channel membership. Add bot as admin to", channelId);
        // Graceful unlock: don't punish user for our misconfiguration
        await setCache(gateTokenKey(token), { ...data, status: "unlocked" }, CACHE_TTL.gate);
        logGateEvent({ steamId64: data.steamId64, event: "unlocked" });
        await ctx.reply(msg.unlocked);
      } else {
        await ctx.reply(msg.error);
      }
    }
  });
}
