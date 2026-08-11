import { NextResponse } from "next/server";
import crypto from "crypto";
import { setCache } from "@/lib/cache/redis";
import { loginTokenKey } from "@/lib/cache/keys";

const TOKEN_TTL = 600;

export async function POST() {
  const bot = process.env.NEXT_PUBLIC_TELEGRAM_BOT;
  if (!bot) {
    return NextResponse.json({ error: "бот не настроен" }, { status: 500 });
  }

  const token = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  await setCache(loginTokenKey(token), { status: "pending" }, TOKEN_TTL);

  return NextResponse.json({
    token,
    url: `https://t.me/${bot}?start=login_${token}`,
  });
}
