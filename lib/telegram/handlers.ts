import type { Api } from "grammy";
import { InlineKeyboard } from "grammy";
import { getBot } from "./bot";
import { getCache, setCache } from "@/lib/cache/redis";
import { CACHE_TTL, gateTokenKey, loginTokenKey } from "@/lib/cache/keys";
import { logGateEvent } from "@/lib/analytics/db";
import { SITE_HOST } from "@/lib/site";

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

const WELCOME = `🎮 Задротометр — разбор по библиотеке Steam.

Что делаю:
→ Подтверждаю подписку на @gamertyper
→ Разблокирую твою карточку

Как получить карточку:
1. Заходи на ${SITE_HOST}
2. Вставь ссылку на Steam-профиль
3. Подпишись на @gamertyper
4. Получи результат!

Канал: @gamertyper
Сайт: ${SITE_HOST}`;

const MESSAGES = {
  ru: {
    unlocked: "✅ Портрет открыт! Вернись на сайт — он уже обновился.",
    notSubscribed: "Сначала подпишись на канал @gamertyper, а потом нажми кнопку ниже.",
    checkButton: "Я подписался ✅",
    expired: "Ссылка устарела. Открой портрет на сайте заново.",
    error: "Что-то пошло не так. Попробуй ещё раз.",
    loginDone: "Готово, вход выполнен. Возвращайся на сайт — страница сама обновится.",
    loginExpired: "Ссылка входа устарела. Нажми «Войти» на сайте ещё раз.",
  },
  en: {
    unlocked: "✅ Portrait unlocked! Go back to the site — it's already updated.",
    notSubscribed: "Subscribe to @gamertyper first, then tap the button below.",
    checkButton: "I've subscribed ✅",
    expired: "This link has expired. Open your portrait on the site again.",
    error: "Something went wrong. Please try again.",
    loginDone: "You're signed in. Head back to the site — the page will update itself.",
    loginExpired: "This sign-in link has expired. Tap “Sign in” on the site again.",
  },
} as const;

let handlersRegistered = false;

export function registerHandlers() {
  if (handlersRegistered) return;
  const bot = getBot();
  if (!bot) return;
  handlersRegistered = true;

  bot.command("start", async (ctx) => {
    const payload = ctx.match?.trim();
    if (!payload) {
      console.log("[gate] /start without token, showing WELCOME");
      await ctx.reply(WELCOME);
      return;
    }

    // Токен ВХОДА и токен ГЕЙТА живут в разных ключах и означают разное.
    // Приставка — единственное, что их различает в ссылке t.me.
    if (payload.startsWith("login_")) {
      const userId = ctx.from?.id;
      if (!userId) return;
      const outcome = await handleLoginStart(userId, payload.slice("login_".length));
      await ctx.reply(outcome === "ok" ? MESSAGES.ru.loginDone : MESSAGES.ru.loginExpired);
      return;
    }

    console.log("[gate] /start с токеном:", payload.slice(0, 8) + "...", "user:", ctx.from?.id);
    await handleGateCheck(ctx.api, ctx.from!.id, payload, (text, opts) => ctx.reply(text, opts));
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

export async function handleLoginStart(userId: number, token: string): Promise<"ok" | "expired"> {
  const data = await getCache<{ status: string }>(loginTokenKey(token));
  if (!data) return "expired";
  // Подтверждаем токен ровно один раз. Иначе последний нажавший Start
  // перезаписывает предыдущего — и заодно продлевает срок жизни токена, —
  // то есть чужое подтверждение можно перебить своим.
  if (data.status === "confirmed") return "expired";
  await setCache(loginTokenKey(token), { status: "confirmed", telegramUserId: String(userId) }, 600);
  return "ok";
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
      // Раньше здесь выдавался доступ «чтобы не ломать пользователя». Это
      // означало: сломай проверку канала — и получай результат бесплатно.
      // Настройка бота — наша проблема, а не повод раздавать платное.
      console.error("[gate] CRITICAL: бот не может проверить подписку, сделай его админом канала", channelId);
    }
    await reply(msg.error);
  }
}
