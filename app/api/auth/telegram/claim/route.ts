import { NextResponse } from "next/server";
import { getCache, deleteCache, incrementRateLimit } from "@/lib/cache/redis";
import { CACHE_TTL, loginAttemptKey, loginCodeKey } from "@/lib/cache/keys";
import { getClientIp } from "@/lib/http/client-ip";
import { loginOrCreate } from "@/lib/identity/store";
import { issueSessionCookie, readSessionFromRequest } from "@/lib/identity/session";

interface LoginCode {
  telegramUserId: number;
}

/** Попыток ввода кода с одного адреса в час. */
const MAX_ATTEMPTS = 10;

export async function POST(req: Request) {
  let code: unknown;
  try {
    ({ code } = await req.json());
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  if (!code || typeof code !== "string") {
    return NextResponse.json({ error: "code required" }, { status: 400 });
  }

  // Потолок попыток — ДО обращения к кешу. Код короткий и вводится руками,
  // поэтому его можно перебирать машиной; без счётчика единственной защитой
  // остаётся длина, а её человеку не увеличишь.
  const attempts = await incrementRateLimit(loginAttemptKey(getClientIp(req)), CACHE_TTL.rateLimit);
  if (attempts > MAX_ATTEMPTS) {
    return NextResponse.json({ error: "too many" }, { status: 429 });
  }

  // Код читают глазами и вставляют из переписки: регистр и краевые пробелы
  // не должны решать, войдёт человек или нет.
  const normalized = code.trim().toUpperCase();

  const data = await getCache<LoginCode>(loginCodeKey(normalized));
  if (!data || !data.telegramUserId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Код одноразовый: он лежит открытым в переписке с ботом, и второй жизни
  // у него быть не должно. Гасим до входа, а не после: любой сбой ниже
  // должен оставить код потраченным, а не годным для второй попытки.
  await deleteCache(loginCodeKey(normalized));

  const current = readSessionFromRequest(req);
  const result = loginOrCreate("telegram", String(data.telegramUserId), {
    currentAccountId: current,
  });

  if (result.status === "taken") {
    return NextResponse.json({ error: "taken" }, { status: 409 });
  }
  if (result.status === "unavailable") {
    // База не ответила — сессию не выдаём. Ошибка закрывает, а не открывает.
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }

  const cookie = issueSessionCookie(result.accountId);
  const res = NextResponse.json({ accountId: result.accountId });
  res.cookies.set(cookie.name, cookie.value, cookie.options);
  return res;
}

export const runtime = "nodejs";
