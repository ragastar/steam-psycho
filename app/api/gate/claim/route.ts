import { NextResponse } from "next/server";
import { getCache } from "@/lib/cache/redis";
import { gateTokenKey } from "@/lib/cache/keys";
import { issueAccessCookie } from "@/lib/access/entitlement";

interface GateData {
  steamId64: string;
  locale: string;
  status: "pending" | "unlocked";
}

/**
 * Меняет открытый гейт-токен на подписанную куку доступа.
 *
 * Токен живёт в localStorage и серверу не виден, поэтому нужен явный обмен:
 * дальше решение о показе полного результата принимает сервер по куке.
 * Когда появится оплата, полный доступ будет выдаваться здесь же.
 */
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

  const data = await getCache<GateData>(gateTokenKey(token));

  // Нет токена или он ещё не открыт — доступа нет. Ошибка закрывает, не открывает.
  if (!data || data.status !== "unlocked") {
    return NextResponse.json({ access: "free" }, { status: 403 });
  }

  const cookie = issueAccessCookie(data.steamId64);
  const res = NextResponse.json({ access: "full", steamId64: data.steamId64 });
  res.cookies.set(cookie.name, cookie.value, cookie.options as Parameters<typeof res.cookies.set>[2]);
  return res;
}
