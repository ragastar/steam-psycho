import { getBot } from "./bot";
import { getCache, setCache } from "@/lib/cache/redis";
import { CACHE_TTL, gateTokenKey } from "@/lib/cache/keys";

interface GateData {
  steamId64: string;
  locale: string;
  status: "pending" | "unlocked";
}

const MESSAGES = {
  ru: {
    unlocked: "Портрет открыт! Вернись на сайт — он уже обновился.",
    notSubscribed: "Сначала подпишись на канал, а потом нажми /start снова:\nhttps://t.me/gamertyper",
    expired: "Ссылка устарела. Открой портрет на сайте заново.",
    error: "Что-то пошло не так. Попробуй ещё раз.",
  },
  en: {
    unlocked: "Portrait unlocked! Go back to the site — it's already updated.",
    notSubscribed: "Subscribe to the channel first, then press /start again:\nhttps://t.me/gamertyper",
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
    if (!token) return;

    const data = await getCache<GateData>(gateTokenKey(token));
    const locale = data?.locale === "en" ? "en" : "ru";
    const msg = MESSAGES[locale];

    if (!data) {
      await ctx.reply(msg.expired);
      return;
    }

    if (data.status === "unlocked") {
      await ctx.reply(msg.unlocked);
      return;
    }

    const channelId = process.env.TELEGRAM_CHANNEL_ID || "@gamertyper";
    try {
      const member = await ctx.api.getChatMember(channelId, ctx.from!.id);
      const isSubscribed = ["member", "administrator", "creator"].includes(member.status);

      if (isSubscribed) {
        await setCache(gateTokenKey(token), { ...data, status: "unlocked" }, CACHE_TTL.gate);
        await ctx.reply(msg.unlocked);
      } else {
        await ctx.reply(msg.notSubscribed);
      }
    } catch {
      await ctx.reply(msg.error);
    }
  });
}
