import { describe, it, expect } from "vitest";
import { GET } from "@/app/api/auth/steam/start/route";
import { localeFromRequest } from "@/lib/locale";

/** Адрес возврата, который мы просим Steam подписать и вернуть. */
function returnToOf(res: Response): URL {
  const steamUrl = new URL(res.headers.get("location") || "");
  return new URL(steamUrl.searchParams.get("openid.return_to") || "");
}

function startRequest(headers: Record<string, string> = {}, query = ""): Request {
  return new Request(`https://zadrotometr.ru/api/auth/steam/start${query}`, { headers });
}

describe("начало входа через Steam", () => {
  it("кладёт метку в адрес возврата и в куку — одну и ту же", async () => {
    const res = await GET(startRequest());

    const state = returnToOf(res).searchParams.get("state");
    expect(state).toBeTruthy();
    const cookie = res.cookies.get("steam_state");
    expect(cookie?.value).toBe(state);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
    expect(cookie?.path).toBe("/");
  });

  it("язык страницы, с которой ушли, едет в подписанном адресе возврата", async () => {
    const res = await GET(startRequest({ referer: "https://zadrotometr.ru/en/result/76561197990915489" }));

    expect(returnToOf(res).searchParams.get("locale")).toBe("en");
  });

  it("без Referer язык берётся из заголовка браузера", async () => {
    const res = await GET(startRequest({ "accept-language": "en-US,en;q=0.9" }));

    expect(returnToOf(res).searchParams.get("locale")).toBe("en");
  });

  it("без единой подсказки — язык по умолчанию", async () => {
    const res = await GET(startRequest());

    expect(returnToOf(res).searchParams.get("locale")).toBe("ru");
  });
});

describe("выбор языка для входа", () => {
  it("явный параметр важнее всего остального", () => {
    const req = new Request("https://zadrotometr.ru/api/auth/steam/start?locale=en", {
      headers: { referer: "https://zadrotometr.ru/ru", "accept-language": "ru" },
    });

    expect(localeFromRequest(req)).toBe("en");
  });

  it("незнакомый язык не принимается ни откуда", () => {
    const req = new Request("https://zadrotometr.ru/api/auth/steam/start?locale=de", {
      headers: { referer: "https://zadrotometr.ru/fr/result/1", "accept-language": "de-DE,de" },
    });

    expect(localeFromRequest(req)).toBe("ru");
  });

  it("мусорный Referer не роняет запрос", () => {
    const req = new Request("https://zadrotometr.ru/api/auth/steam/start", {
      headers: { referer: "not-a-url-at-all" },
    });

    expect(localeFromRequest(req)).toBe("ru");
  });
});
