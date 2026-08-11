import { NextResponse } from "next/server";
import crypto from "crypto";
import { buildAuthUrl } from "@/lib/identity/steam-openid";
import { SITE_URL } from "@/lib/site";

/**
 * Имя куки с одноразовой меткой — то же самое имя захардкожено в
 * /callback (см. там подробности про Login CSRF). Экспортировать нельзя:
 * из файла маршрута можно отдавать только обработчик и runtime.
 */
const STATE_COOKIE = "steam_state";
const STATE_TTL = 600; // 10 минут — с запасом на то, чтобы войти в Steam

export async function GET() {
  // Метка привязывает ответ Steam к ЭТОМУ браузеру: без нее подписанную,
  // но чужую ссылку возврата можно подсунуть жертве и войти под чужим
  // Steam-аккаунтом в её сессию (Login CSRF). Кладём метку в адрес
  // возврата — Steam подписывает его целиком и вернёт без изменений.
  const state = crypto.randomUUID();
  const returnTo = `${SITE_URL}/api/auth/steam/callback?state=${state}`;

  const res = NextResponse.redirect(buildAuthUrl(returnTo, SITE_URL));
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" && process.env.ALLOW_INSECURE_COOKIES !== "true",
    sameSite: "lax",
    path: "/",
    maxAge: STATE_TTL,
  });
  return res;
}
