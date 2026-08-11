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
function callbackRequest(opts: {
  returnToState?: string;
  cookieState?: string;
  /** Сырой заголовок Cookie — для проверки границ имени куки. */
  rawCookie?: string;
  locale?: string;
  /** Разбор, с которого ушли входить, — едет тем же подписанным адресом. */
  back?: string;
}): Request {
  const query = new URLSearchParams();
  if (opts.returnToState !== undefined) query.set("state", opts.returnToState);
  if (opts.locale !== undefined) query.set("locale", opts.locale);
  if (opts.back !== undefined) query.set("back", opts.back);
  const returnTo =
    query.size === 0
      ? "https://zadrotometr.ru/api/auth/steam/callback"
      : `https://zadrotometr.ru/api/auth/steam/callback?${query.toString()}`;

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
  if (opts.rawCookie !== undefined) {
    headers.set("cookie", opts.rawCookie);
  } else if (opts.cookieState !== undefined) {
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
  it("кука с похожим именем меткой не считается", async () => {
    stubValidFetch();
    const { GET } = await freshCallback(dbPath);

    // xsteam_state — не steam_state. Нестрогая регулярка без границы имени
    // считала бы иначе, и защита от подсунутой ссылки обходилась бы одной
    // лишней кукой.
    const res = await GET(
      callbackRequest({ returnToState: "secret123", rawCookie: "xsteam_state=secret123" }),
    );

    expect(res.headers.get("location")).toContain("login=failed");
    expect(res.cookies.get("gt_session")).toBeUndefined();
  });
});

describe("покупатель возвращается на свой разбор, а не на лендинг", () => {
  it("номер разбора из подписанного адреса уводит на этот разбор", async () => {
    stubValidFetch();
    const { GET } = await freshCallback(dbPath);

    const res = await GET(
      callbackRequest({ returnToState: "secret123", cookieState: "secret123", back: "76561197990915489" }),
    );

    // Человек нажимал «купить», а не «войти»: лендинг после входа означает
    // потерянную покупку — а это самый дорогой шаг воронки.
    expect(res.headers.get("location")).toBe(
      "https://zadrotometr.ru/ru/result/76561197990915489?login=ok",
    );
  });

  it("отказ возвращает туда же — на разбор, а не на главную", async () => {
    stubValidFetch();
    const { GET } = await freshCallback(dbPath);

    const res = await GET(
      callbackRequest({ returnToState: "чужая метка", cookieState: "secret123", back: "76561197990915489" }),
    );

    expect(res.headers.get("location")).toBe(
      "https://zadrotometr.ru/ru/result/76561197990915489?login=failed",
    );
    expect(res.cookies.get("gt_session")).toBeUndefined();
  });

  it("мусор в поле возврата не уезжает в редирект", async () => {
    stubValidFetch();

    // Подписанный адрес приходит от Steam, но подпись сверяется ПОСЛЕ, а путь
    // складывается уже здесь: пускать в него что попало нельзя.
    for (const back of ["//evil.example", "https://evil.example/x", "76561197990915489a", "1"]) {
      const { GET } = await freshCallback(dbPath);
      const res = await GET(
        callbackRequest({ returnToState: "secret123", cookieState: "secret123", back }),
      );

      expect(res.headers.get("location")).toBe("https://zadrotometr.ru/ru?login=ok");
    }
  });
});

describe("язык переживает поход в Steam", () => {
  it("вход, начатый на английской версии, возвращает на английскую", async () => {
    stubValidFetch();
    const { GET } = await freshCallback(dbPath);

    const res = await GET(
      callbackRequest({ returnToState: "secret123", cookieState: "secret123", locale: "en" }),
    );

    expect(res.headers.get("location")).toBe("https://zadrotometr.ru/en?login=ok");
  });

  it("отказ тоже возвращает на язык, с которого начинали", async () => {
    stubValidFetch();
    const { GET } = await freshCallback(dbPath);

    const res = await GET(callbackRequest({ returnToState: "someone-elses-mark", cookieState: "secret123", locale: "en" }));

    expect(res.headers.get("location")).toBe("https://zadrotometr.ru/en?login=failed");
  });

  it("незнакомый язык в адресе возврата подменяется языком по умолчанию", async () => {
    stubValidFetch();
    const { GET } = await freshCallback(dbPath);

    // Список языков закрытый: подставить в подписанный адрес свой «язык»
    // и увести человека на чужой адрес нельзя.
    const res = await GET(
      callbackRequest({ returnToState: "secret123", cookieState: "secret123", locale: "//evil.example" }),
    );

    expect(res.headers.get("location")).toBe("https://zadrotometr.ru/ru?login=ok");
  });
});
