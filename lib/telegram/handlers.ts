import crypto from "crypto";
import { getBot } from "./bot";
import { setCache } from "@/lib/cache/redis";
import { loginCodeKey } from "@/lib/cache/keys";
import { SITE_HOST } from "@/lib/site";

/**
 * Бот сегодня умеет ровно одно: выдать код для входа на сайт. Гейт на подписку
 * канала («подпишись — получи карточку») отменён как бизнес-модель 2026-08-10,
 * и вместе с ним отсюда убраны проверка подписки, разбор гейт-токена и кнопка
 * «я подписался»: токены больше некому создавать, а обещание бесплатной
 * карточки за подписку прямо противоречило бы витрине покупки. Канал остаётся
 * каналом трафика, доступа он не даёт.
 */
const WELCOME = `🎮 Задротометр — разбор по библиотеке Steam.

Как получить разбор:
1. Заходи на ${SITE_HOST}
2. Вставь ссылку на Steam-профиль
3. Читай бесплатный вердикт — карточку с архетипом и цифрами

Полный разбор открывается на сайте. Я нужен для входа: сайт попросит код — жми
кнопку «Через Telegram», и я его пришлю.

Канал: @gamertyper
Сайт: ${SITE_HOST}`;

const MESSAGES = {
  ru: {
    loginCode:
      "Твой код для входа: %s\n\nВведи его на сайте, он действует 10 минут. Никому не передавай — по нему входят в твой аккаунт.",
  },
  en: {
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

    // Ссылка входа не несёт токена: бот САМ выдаёт код, а вводят его на сайте.
    // Раньше было наоборот — сайт выдавал токен, а человек молча подтверждал
    // его нажатием, и подсунутая жертве ссылка отдавала злоумышленнику сессию
    // на её аккаунт.
    if (payload === "login") {
      const userId = ctx.from?.id;
      if (!userId) return;
      const code = await issueLoginCode(userId);
      const locale = ctx.from?.language_code?.startsWith("en") ? "en" : "ru";
      await ctx.reply(MESSAGES[locale].loginCode.replace("%s", code));
      return;
    }

    // Любая другая полезная нагрузка — приветствие. Старые ссылки гейта
    // (`/start <токен>`) ещё ходят по чатам, и человек, открывший такую,
    // обязан прочесть, чем продукт занят сегодня, а не молчание.
    await ctx.reply(WELCOME);
  });
}

/**
 * Знаки, которые нельзя спутать при чтении с экрана: без I, O, 0 и 1.
 *
 * Наружу торчат затем, что маршрут приёма проверяет по ним форму присланной
 * строки. Пусть форма кода описана в одном месте — там, где коды делают, —
 * иначе проверка с генерацией однажды разъедутся и запрут вход для всех.
 */
export const LOGIN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const LOGIN_CODE_LENGTH = 8;
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
