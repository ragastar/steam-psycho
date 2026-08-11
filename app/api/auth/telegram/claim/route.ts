import { NextResponse } from "next/server";
import { getCache, deleteCache } from "@/lib/cache/redis";
import { loginTokenKey } from "@/lib/cache/keys";
import { loginOrCreate } from "@/lib/identity/store";
import {
  CLEAR_COOKIE_OPTIONS,
  LOGIN_TOKEN_COOKIE,
  issueSessionCookie,
  readCookie,
  readSessionFromRequest,
  timingSafeEqualStrings,
} from "@/lib/identity/session";

interface LoginToken {
  status: "pending" | "confirmed";
  telegramUserId?: string;
}

/** Кука привязки одноразовая: токен уже потрачен, держать её незачем. */
function clearBinding(res: NextResponse): NextResponse {
  res.cookies.set(LOGIN_TOKEN_COOKIE, "", CLEAR_COOKIE_OPTIONS);
  return res;
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

  // Токен обменивает только тот браузер, которому его выдали на /start.
  // Подтверждение от бота говорит, КТО нажал Start, но ничего не говорит о
  // том, кто сейчас стучится за сессией: без этой сверки злоумышленник
  // получал сессию на аккаунт жертвы, просто прислав ей ссылку. Проверяем
  // ДО обращения к кешу — чужой запрос не должен гасить живой токен.
  const bound = readCookie(req.headers.get("cookie"), LOGIN_TOKEN_COOKIE);
  if (!bound || !timingSafeEqualStrings(bound, token)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const data = await getCache<LoginToken>(loginTokenKey(token));
  // Нет токена, не подтверждён, нет пользователя — отказ. Ошибка закрывает.
  if (!data || data.status !== "confirmed" || !data.telegramUserId) {
    return NextResponse.json({ error: "pending" }, { status: 403 });
  }

  // Токен одноразовый: он лежит в открытом виде в браузере и в переписке
  // с ботом, поэтому второй жизни у него быть не должно.
  await deleteCache(loginTokenKey(token));

  const current = readSessionFromRequest(req);
  const result = loginOrCreate("telegram", data.telegramUserId, { currentAccountId: current });

  if (result.status === "taken") {
    return clearBinding(NextResponse.json({ error: "taken" }, { status: 409 }));
  }
  if (result.status === "unavailable") {
    // База не ответила — сессию не выдаём. Ошибка закрывает, а не открывает.
    return clearBinding(NextResponse.json({ error: "unavailable" }, { status: 503 }));
  }

  const cookie = issueSessionCookie(result.accountId);
  const res = NextResponse.json({ accountId: result.accountId });
  res.cookies.set(cookie.name, cookie.value, cookie.options);
  return clearBinding(res);
}

export const runtime = "nodejs";
