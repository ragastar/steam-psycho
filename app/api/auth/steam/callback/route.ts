import { NextResponse } from "next/server";
import { verifyAssertion, STEAM_STATE_COOKIE } from "@/lib/identity/steam-openid";
import { loginOrCreate } from "@/lib/identity/store";
import {
  CLEAR_COOKIE_OPTIONS,
  issueSessionCookie,
  readCookie,
  readSessionFromRequest,
  timingSafeEqualStrings,
} from "@/lib/identity/session";
import { normalizeLocale } from "@/lib/locale";
import { defaultLocale } from "@/i18n/request";
import { SITE_URL } from "@/lib/site";

/**
 * Достаёт значение из openid.return_to, а не из отдельного параметра адреса.
 *
 * openid.return_to — то самое поле, которое Steam подписывает и возвращает
 * без изменений (verifyAssertion требует, чтобы оно входило в openid.signed,
 * и check_authentication его проверяет). Если тянуть метку из произвольного
 * параметра запроса рядом с openid.*, её ничто не защищает от подмены —
 * читать нужно именно то значение, что подтверждено подписью.
 */
function fromReturnTo(params: URLSearchParams, name: string): string | null {
  const returnTo = params.get("openid.return_to");
  if (!returnTo) return null;
  try {
    return new URL(returnTo).searchParams.get(name);
  } catch {
    return null;
  }
}

/** Та же форма, что на /start: обратно едет Steam ID разбора, а не путь. */
const BACK_SHAPE = /^\d{17}$/;

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;

  // Язык, с которого начинали вход, приехал в подписанном адресе возврата.
  // Отказные ветки ниже срабатывают ДО проверки подписи, поэтому здесь
  // значение ещё не доказано — но выбор ограничен списком языков, так что
  // худшее, что может сделать подделка, — увести человека на свой язык.
  const locale = normalizeLocale(fromReturnTo(params, "locale")) ?? defaultLocale;

  // Разбор, с которого ушли входить. Проверяем ещё раз здесь, а не полагаемся
  // на проверку в /start: адрес возврата хоть и подписан Steam'ом, но подпись
  // сверяется ниже, а этот адрес складывается уже сейчас. Семнадцать цифр
  // подставляются в ПУТЬ, поэтому пускать туда что попало нельзя.
  const rawBack = fromReturnTo(params, "back");
  const back = rawBack && BACK_SHAPE.test(rawBack) ? rawBack : null;

  // Вернуть человека надо туда, откуда он ушёл: он нажимал «купить», а не
  // «войти», и лендинг после входа означает потерянную покупку. Без `back` —
  // прежнее поведение, главная.
  const home = (outcome: string) =>
    NextResponse.redirect(
      back
        ? `${SITE_URL}/${locale}/result/${back}?login=${outcome}`
        : `${SITE_URL}/${locale}?login=${outcome}`,
    );

  // Защита от Login CSRF (session fixation): подписанная Steam'ом ссылка
  // возврата сама по себе ничего не доказывает про то, КТО её открыл —
  // получить такую ссылку может кто угодно, войдя под своим аккаунтом, и
  // разослать её жертвам. Без сверки метки, выданной именно этому браузеру
  // на /start, чужая ссылка входит под чужим аккаунтом в сессию того, кто
  // её открыл. Ошибка любого рода здесь — отказ.
  const cookieState = readCookie(req.headers.get("cookie"), STEAM_STATE_COOKIE);
  const urlState = fromReturnTo(params, "state");
  const stateOk = !!cookieState && !!urlState && timingSafeEqualStrings(cookieState, urlState);

  if (!stateOk) {
    return home("failed");
  }

  // Метка одноразовая: она подтверждена, второй раз её проверять незачем и
  // небезопасно оставлять — гасим куку на любом исходе ниже.
  const clearState = (res: NextResponse) => {
    res.cookies.set(STEAM_STATE_COOKIE, "", CLEAR_COOKIE_OPTIONS);
    return res;
  };

  const steamId = await verifyAssertion(params);

  if (!steamId) {
    return clearState(home("failed"));
  }

  const current = readSessionFromRequest(req);
  // Вход через Steam доказывает владение аккаунтом (проверка в
  // steam-openid.ts), поэтому привязка создаётся сразу подтверждённой —
  // в отличие от Telegram, где ничего не доказано.
  const result = loginOrCreate("steam", steamId, { currentAccountId: current, verified: true });

  if (result.status === "taken") {
    return clearState(home("taken"));
  }
  if (result.status === "unavailable") {
    // База не ответила — сессию не выдаём. Ошибка закрывает, а не открывает.
    return clearState(home("failed"));
  }

  const cookie = issueSessionCookie(result.accountId);
  const res = home("ok");
  res.cookies.set(cookie.name, cookie.value, cookie.options);
  return clearState(res);
}

export const runtime = "nodejs";
