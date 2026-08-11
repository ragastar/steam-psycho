import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * Проверяет защиту от Login CSRF (session fixation) на возврате из Steam:
 * без метки, привязывающей ответ к браузеру, который начинал вход, чужая
 * (но подлинно подписанная Steam'ом) ссылка входит под чужим аккаунтом —
 * тому, кто её открыл. Метка живёт в отдельной одноразовой куке и должна
 * совпасть с меткой внутри openid.return_to.
 */
async function freshCallback(dbPath: string) {
  process.env.IDENTITY_DB_PATH = dbPath;
  process.env.ACCESS_SECRET = "секрет-подлиннее-шестнадцати";
  vi.resetModules();
  return import("@/app/api/auth/steam/callback/route");
}

const CLAIMED_ID = "https://steamcommunity.com/openid/id/76561197990915489";

function stubValidFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "ns:http://specs.openid.net/auth/2.0\nis_valid:true\n",
    }),
  );
}

/**
 * Собирает запрос на /callback так, как его прислал бы браузер после
 * ответа Steam: openid.return_to несёт ту метку, что была отправлена на
 * /start, и подписан целиком (в тесте подпись не проверяется по-настоящему —
 * это делает замоканный fetch, — важна форма запроса).
 */
function callbackRequest(opts: { returnToState?: string; cookieState?: string }): Request {
  const returnTo =
    opts.returnToState === undefined
      ? "https://zadrotometr.ru/api/auth/steam/callback"
      : `https://zadrotometr.ru/api/auth/steam/callback?state=${opts.returnToState}`;

  const params = new URLSearchParams({
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "id_res",
    "openid.claimed_id": CLAIMED_ID,
    "openid.identity": CLAIMED_ID,
    "openid.return_to": returnTo,
    "openid.sig": "подпись",
    "openid.signed": "signed,op_endpoint,claimed_id,identity,return_to",
  });

  const headers = new Headers();
  if (opts.cookieState !== undefined) {
    headers.set("cookie", `steam_state=${opts.cookieState}`);
  }

  return new Request(`https://zadrotometr.ru/api/auth/steam/callback?${params.toString()}`, {
    headers,
  });
}

let dbPath: string;

beforeEach(() => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "steam-callback-")), "identity.db");
});

afterEach(() => {
  delete process.env.IDENTITY_DB_PATH;
  delete process.env.ACCESS_SECRET;
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("защита возврата из Steam от Login CSRF", () => {
  it("метка в адресе совпадает с меткой в куке — вход происходит", async () => {
    stubValidFetch();
    const { GET } = await freshCallback(dbPath);

    const res = await GET(callbackRequest({ returnToState: "secret123", cookieState: "secret123" }));

    expect(res.headers.get("location")).toContain("login=ok");
    expect(res.cookies.get("gt_session")?.value).toBeTruthy();
    // Метка одноразовая: после успешного входа кука с ней должна быть погашена.
    expect(res.cookies.get("steam_state")?.value).toBe("");
  });

  it("метка в адресе не совпадает с меткой в куке — отказ, сессия не выдаётся", async () => {
    stubValidFetch();
    const { GET } = await freshCallback(dbPath);

    const res = await GET(callbackRequest({ returnToState: "someone-elses-mark", cookieState: "secret123" }));

    expect(res.headers.get("location")).toContain("login=failed");
    expect(res.cookies.get("gt_session")).toBeUndefined();
  });

  it("куки с меткой нет вообще — отказ", async () => {
    stubValidFetch();
    const { GET } = await freshCallback(dbPath);

    const res = await GET(callbackRequest({ returnToState: "secret123" }));

    expect(res.headers.get("location")).toContain("login=failed");
    expect(res.cookies.get("gt_session")).toBeUndefined();
  });

  it("метки в адресе нет — отказ", async () => {
    stubValidFetch();
    const { GET } = await freshCallback(dbPath);

    const res = await GET(callbackRequest({ cookieState: "secret123" }));

    expect(res.headers.get("location")).toContain("login=failed");
    expect(res.cookies.get("gt_session")).toBeUndefined();
  });
});
