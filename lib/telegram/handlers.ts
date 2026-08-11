import crypto from "crypto";
import type { Api } from "grammy";
import { InlineKeyboard } from "grammy";
import { getBot } from "./bot";
import { getCache, setCache } from "@/lib/cache/redis";
import { CACHE_TTL, gateTokenKey, loginCodeKey } from "@/lib/cache/keys";
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
    loginCode:
      "Твой код для входа: %s\n\nВведи его на сайте, он действует 10 минут. Никому не передавай — по нему входят в твой аккаунт.",
  },
  en: {
    unlocked: "✅ Portrait unlocked! Go back to the site — it's already updated.",
    notSubscribed: "Subscribe to @gamertyper first, then tap the button below.",
    checkButton: "I've subscribed ✅",
    expired: "This link has expired. Open your portrait on the site again.",
    error: "Something went wrong. Please try again.",
    loginCode:
      "Your sign-in code: %s\n\nEnter it on the site, it works for 10 minutes. Don't share it with anyone — it signs into your account.",
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

    // Ссылка входа не несёт токена: бот САМ выдаёт код, а вводят его на сайте.
    // Раньше было наоборот — сайт выдавал токен, а человек молча подтверждал
    // его нажатием, и подсунутая жертве ссылка отдавала злоумышленнику сессию
    // на её аккаунт. Гейт-токен так и остаётся полезной нагрузкой, поэтому
    // слово "login" отличает вход от него.
    if (payload === "login") {
      const userId = ctx.from?.id;
      if (!userId) return;
      const code = await issueLoginCode(userId);
      const locale = ctx.from?.language_code?.startsWith("en") ? "en" : "ru";
      await ctx.reply(MESSAGES[locale].loginCode.replace("%s", code));
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

/** Знаки, которые нельзя спутать при чтении с экрана: без I, O, 0 и 1. */
const LOGIN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const LOGIN_CODE_LENGTH = 8;
const LOGIN_CODE_TTL = 600;

/**
 * Выдаёт одноразовый код входа тому, кто написал боту.
 *
 * Знаки берутся из crypto.randomInt, а не из Math.random: это пропуск в
 * аккаунт, и предсказуемый генератор здесь означает предсказуемый чужой вход.
 */
export async function issueLoginCode(telegramUserId: number): Promise<string> {
  let code = "";
  for (let i = 0; i < LOGIN_CODE_LENGTH; i++) {
    code += LOGIN_CODE_ALPHABET[crypto.randomInt(LOGIN_CODE_ALPHABET.length)];
  }
  await setCache(loginCodeKey(code), { telegramUserId }, LOGIN_CODE_TTL);
  return code;
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
