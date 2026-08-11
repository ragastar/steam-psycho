import { NextResponse } from "next/server";
import { getCache, deleteCache, incrementRateLimit } from "@/lib/cache/redis";
import { CACHE_TTL, loginAttemptKey, loginCodeKey } from "@/lib/cache/keys";
import { getClientIp } from "@/lib/http/client-ip";
import { loginOrCreate } from "@/lib/identity/store";
import { issueSessionCookie, readSessionFromRequest } from "@/lib/identity/session";
import { LOGIN_CODE_ALPHABET, LOGIN_CODE_LENGTH } from "@/lib/telegram/handlers";

interface LoginCode {
  telegramUserId: number;
}

/** НЕУДАЧНЫХ попыток ввода кода с одного адреса в час. */
const MAX_FAILED_ATTEMPTS = 10;

/**
 * Форма кода берётся оттуда же, где коды делают: разъедься проверка с
 * генерацией — и вход закроется для всех. В алфавите только буквы и цифры,
 * особых знаков регулярки там нет.
 */
const CODE_SHAPE = new RegExp(`^[${LOGIN_CODE_ALPHABET}]{${LOGIN_CODE_LENGTH}}$`);

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

  // Потолок — ДО обращения к кешу. Код короткий и вводится руками, поэтому его
  // можно перебирать машиной; без счётчика единственной защитой остаётся длина,
  // а её человеку не увеличишь. Считаем только НЕУДАЧИ и только их же и
  // прибавляем ниже: успешный вход корзину тратить не должен, иначе за общим
  // NAT (офис, мобильный оператор) одиннадцатый вошедший за час получает отказ,
  // ничего не сделав. Здесь же лишь читаем счётчик — сам отказ по потолку
  // корзину не трогает, иначе стучащийся продлевал бы себе блокировку.
  const attemptsKey = loginAttemptKey(getClientIp(req));
  const failed = (await getCache<number>(attemptsKey)) ?? 0;
  if (failed >= MAX_FAILED_ATTEMPTS) {
    return NextResponse.json({ error: "too many" }, { status: 429 });
  }

  // Код читают глазами и вставляют из переписки: регистр и краевые пробелы
  // не должны решать, войдёт человек или нет.
  const normalized = code.trim().toUpperCase();

  // Строка не той формы кодом быть не может — заворачиваем её, не тратя ни
  // обращения к кешу, ни места в корзине попыток.
  if (!CODE_SHAPE.test(normalized)) {
    return NextResponse.json({ error: "code invalid" }, { status: 400 });
  }

  const data = await getCache<LoginCode>(loginCodeKey(normalized));
  if (!data || !data.telegramUserId) {
    await incrementRateLimit(attemptsKey, CACHE_TTL.rateLimit);
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
