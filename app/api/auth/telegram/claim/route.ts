import { NextResponse } from "next/server";
import { getCache, deleteCache } from "@/lib/cache/redis";
import { loginTokenKey } from "@/lib/cache/keys";
import { loginOrCreate } from "@/lib/identity/store";
import { issueSessionCookie, verifySessionValue } from "@/lib/identity/session";

interface LoginToken {
  status: "pending" | "confirmed";
  telegramUserId?: string;
}

export async function POST(req: Request) {
  let token: string | undefined;
  try {
    ({ token } = await req.json());
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  if (!token || typeof token !== "string") {
    return NextResponse.json({ error: "token required" }, { status: 400 });
  }

  const data = await getCache<LoginToken>(loginTokenKey(token));
  // Нет токена, не подтверждён, нет пользователя — отказ. Ошибка закрывает.
  if (!data || data.status !== "confirmed" || !data.telegramUserId) {
    return NextResponse.json({ error: "pending" }, { status: 403 });
  }

  // Токен одноразовый: он лежит в открытом виде в браузере и в переписке
  // с ботом, поэтому второй жизни у него быть не должно.
  await deleteCache(loginTokenKey(token));

  const current = verifySessionValue(req.headers.get("cookie")?.match(/gt_session=([^;]+)/)?.[1]);
  const result = loginOrCreate("telegram", data.telegramUserId, { currentAccountId: current });

  if (result.status === "taken") {
    return NextResponse.json({ error: "taken" }, { status: 409 });
  }

  const cookie = issueSessionCookie(result.accountId);
  const res = NextResponse.json({ accountId: result.accountId });
  res.cookies.set(cookie.name, cookie.value, cookie.options as Parameters<typeof res.cookies.set>[2]);
  return res;
}

export const runtime = "nodejs";
