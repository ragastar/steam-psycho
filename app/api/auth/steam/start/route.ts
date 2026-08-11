import { NextResponse } from "next/server";
import crypto from "crypto";
import { buildAuthUrl, STEAM_STATE_COOKIE } from "@/lib/identity/steam-openid";
import { authCookieOptions } from "@/lib/identity/session";
import { localeFromRequest } from "@/lib/locale";
import { SITE_URL } from "@/lib/site";

const STATE_TTL = 600; // 10 минут — с запасом на то, чтобы войти в Steam

/**
 * Разбор, на который человека надо вернуть после входа, — ровно 17 цифр.
 *
 * Провозим НЕ путь, а Steam ID: адрес возврата сервер склеивает сам из
 * проверенного значения, поэтому увести человека на чужой сайт этим полем
 * нечем в принципе. Открытый редирект из формы входа — классическая дыра, и
 * разбирать ради неё произвольные пути незачем.
 */
const BACK_SHAPE = /^\d{17}$/;

export async function GET(req: Request) {
  // Метка привязывает ответ Steam к ЭТОМУ браузеру: без нее подписанную,
  // но чужую ссылку возврата можно подсунуть жертве и войти под чужим
  // Steam-аккаунтом в её сессию (Login CSRF). Кладём метку в адрес
  // возврата — Steam подписывает его целиком и вернёт без изменений.
  const state = crypto.randomUUID();
  // Язык едет тем же путём и по той же причине: адрес возврата подписан,
  // значит вернуть человека на его язык можно, ничему не доверяя лишнего.
  // Без этого англоязычного посетителя после входа выбрасывало на /ru.
  const locale = localeFromRequest(req);

  // Тем же подписанным путём едет и разбор, с которого начинали. Без него
  // человек, нажавший «купить» и отправленный войти, возвращался на лендинг —
  // с потерянным намерением и без ссылки назад. Мусорный `back` молча
  // выбрасываем: ошибка в этом поле не должна мешать войти.
  const back = new URL(req.url).searchParams.get("back");
  const backPart = back && BACK_SHAPE.test(back) ? `&back=${back}` : "";

  const returnTo = `${SITE_URL}/api/auth/steam/callback?state=${state}&locale=${locale}${backPart}`;

  const res = NextResponse.redirect(buildAuthUrl(returnTo, SITE_URL));
  res.cookies.set(STEAM_STATE_COOKIE, state, authCookieOptions(STATE_TTL));
  return res;
}

// buildAuthUrl тянет только crypto, но маршрут ходит одной цепочкой с
// остальным входом (better-sqlite3) — держим runtime единым для всех пяти.
export const runtime = "nodejs";
