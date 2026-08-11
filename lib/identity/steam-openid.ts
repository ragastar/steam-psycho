/**
 * Вход через Steam по OpenID 2.0 — единственный способ доказать, что
 * Steam-аккаунт принадлежит именно этому человеку. Пароль Steam при этом
 * нам не показывают и мы его не видим.
 */
const STEAM_OPENID = "https://steamcommunity.com/openid/login";
const IDENTIFIER_SELECT = "http://specs.openid.net/auth/2.0/identifier_select";
const CLAIMED_ID_PREFIX = "https://steamcommunity.com/openid/id/";

export function buildAuthUrl(returnTo: string, realm: string): string {
  const params = new URLSearchParams({
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "checkid_setup",
    "openid.return_to": returnTo,
    "openid.realm": realm,
    "openid.identity": IDENTIFIER_SELECT,
    "openid.claimed_id": IDENTIFIER_SELECT,
  });
  return `${STEAM_OPENID}?${params.toString()}`;
}

/**
 * Проверяет ответ Steam и возвращает steamId64.
 *
 * Проверка идёт ОБРАТНЫМ запросом к Steam (`check_authentication`): доверять
 * подписи в адресной строке нельзя, её пишет браузер. Любая осечка — сетевая
 * ошибка, чужой адрес личности, is_valid:false — это отказ, а не пропуск.
 */
export async function verifyAssertion(params: URLSearchParams): Promise<string | null> {
  const claimedId = params.get("openid.claimed_id") || "";
  if (!claimedId.startsWith(CLAIMED_ID_PREFIX)) return null;

  const steamId = claimedId.slice(CLAIMED_ID_PREFIX.length);
  if (!/^\d{17}$/.test(steamId)) return null;

  const body = new URLSearchParams(params);
  body.set("openid.mode", "check_authentication");

  try {
    const res = await fetch(STEAM_OPENID, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) return null;
    const text = await res.text();
    return /(^|\n)is_valid:true/.test(text) ? steamId : null;
  } catch {
    return null;
  }
}
