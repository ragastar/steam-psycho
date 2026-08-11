import { NextResponse } from "next/server";
import crypto from "crypto";
import { verifyAssertion } from "@/lib/identity/steam-openid";
import { loginOrCreate } from "@/lib/identity/store";
import { issueSessionCookie, verifySessionValue } from "@/lib/identity/session";
import { SITE_URL } from "@/lib/site";

/** То же имя куки, что в /start. Экспортировать нельзя — см. правило там. */
const STATE_COOKIE = "steam_state";

function loginFailed() {
  return NextResponse.redirect(`${SITE_URL}/ru?login=failed`);
}

/**
 * Достаёт метку из openid.return_to, а не из отдельного параметра адреса.
 *
 * openid.return_to — то самое поле, которое Steam подписывает и возвращает
 * без изменений (оно входит в openid.signed, и check_authentication его
 * проверяет). Если тянуть метку из произвольного параметра запроса рядом с
 * openid.*, её ничто не защищает от подмены — читать нужно именно то
 * значение, что подтверждено подписью.
 */
function extractStateFromReturnTo(params: URLSearchParams): string | null {
  const returnTo = params.get("openid.return_to");
  if (!returnTo) return null;
  try {
    return new URL(returnTo).searchParams.get("state");
  } catch {
    return null;
  }
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  // timingSafeEqual падает на разной длине, поэтому длину проверяем заранее.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;

  // Защита от Login CSRF (session fixation): подписанная Steam'ом ссылка
  // возврата сама по себе ничего не доказывает про то, КТО её открыл —
  // получить такую ссылку может кто угодно, войдя под своим аккаунтом, и
  // разослать её жертвам. Без сверки метки, выданной именно этому браузеру
  // на /start, чужая ссылка входит под чужим аккаунтом в сессию того, кто
  // её открыл. Ошибка любого рода здесь — отказ.
  const cookieState = req.headers.get("cookie")?.match(/steam_state=([^;]+)/)?.[1];
  const urlState = extractStateFromReturnTo(params);
  const stateOk = !!cookieState && !!urlState && timingSafeEqualStrings(cookieState, urlState);

  if (!stateOk) {
    return loginFailed();
  }

  // Метка одноразовая: она подтверждена, второй раз её проверять незачем и
  // небезопасно оставлять — гасим куку на любом исходе ниже.
  const clearState = (res: NextResponse) => {
    res.cookies.set(STATE_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  };

  const steamId = await verifyAssertion(params);

  if (!steamId) {
    return clearState(loginFailed());
  }

  const current = verifySessionValue(req.headers.get("cookie")?.match(/gt_session=([^;]+)/)?.[1]);
  // Вход через Steam доказывает владение аккаунтом (проверка в
  // steam-openid.ts), поэтому привязка создаётся сразу подтверждённой —
  // в отличие от Telegram, где ничего не доказано.
  const result = loginOrCreate("steam", steamId, { currentAccountId: current, verified: true });

  if (result.status === "taken") {
    return clearState(NextResponse.redirect(`${SITE_URL}/ru?login=taken`));
  }

  const cookie = issueSessionCookie(result.accountId);
  const res = NextResponse.redirect(`${SITE_URL}/ru?login=ok`);
  res.cookies.set(cookie.name, cookie.value, cookie.options as Parameters<typeof res.cookies.set>[2]);
  return clearState(res);
}

export const runtime = "nodejs";
