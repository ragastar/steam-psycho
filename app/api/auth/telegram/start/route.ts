import { NextResponse } from "next/server";
import crypto from "crypto";
import { setCache } from "@/lib/cache/redis";
import { loginTokenKey } from "@/lib/cache/keys";
import { LOGIN_TOKEN_COOKIE, authCookieOptions } from "@/lib/identity/session";

const TOKEN_TTL = 600;

export async function POST() {
  const bot = process.env.NEXT_PUBLIC_TELEGRAM_BOT;
  if (!bot) {
    return NextResponse.json({ error: "бот не настроен" }, { status: 500 });
  }

  const token = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  await setCache(loginTokenKey(token), { status: "pending" }, TOKEN_TTL);

  const res = NextResponse.json({
    token,
    url: `https://t.me/${bot}?start=login_${token}`,
  });

  // Кука привязывает токен к ЭТОМУ браузеру — так же, как метка привязывает
  // ответ Steam на /api/auth/steam/start. Без неё три шага входа (выдача
  // токена, подтверждение ботом, обмен на сессию) ничем не связаны между
  // собой: злоумышленник берёт токен себе, подсовывает ссылку жертве и
  // получает сессию НА ЕЁ аккаунт. Срок — как у самого токена.
  res.cookies.set(LOGIN_TOKEN_COOKIE, token, authCookieOptions(TOKEN_TTL));
  return res;
}

// setCache пишет в SQLite (better-sqlite3) — только nodejs.
export const runtime = "nodejs";
