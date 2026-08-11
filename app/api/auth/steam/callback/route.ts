import { NextResponse } from "next/server";
import { verifyAssertion } from "@/lib/identity/steam-openid";
import { loginOrCreate } from "@/lib/identity/store";
import { issueSessionCookie, verifySessionValue } from "@/lib/identity/session";
import { SITE_URL } from "@/lib/site";

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const steamId = await verifyAssertion(params);

  if (!steamId) {
    return NextResponse.redirect(`${SITE_URL}/ru?login=failed`);
  }

  const current = verifySessionValue(req.headers.get("cookie")?.match(/gt_session=([^;]+)/)?.[1]);
  // Вход через Steam доказывает владение аккаунтом (проверка в
  // steam-openid.ts), поэтому привязка создаётся сразу подтверждённой —
  // в отличие от Telegram, где ничего не доказано.
  const result = loginOrCreate("steam", steamId, { currentAccountId: current, verified: true });

  if (result.status === "taken") {
    return NextResponse.redirect(`${SITE_URL}/ru?login=taken`);
  }

  const cookie = issueSessionCookie(result.accountId);
  const res = NextResponse.redirect(`${SITE_URL}/ru?login=ok`);
  res.cookies.set(cookie.name, cookie.value, cookie.options as Parameters<typeof res.cookies.set>[2]);
  return res;
}

export const runtime = "nodejs";
