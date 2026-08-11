import crypto from "crypto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  issueSessionCookie,
  readCookie,
  verifySessionValue,
  SESSION_COOKIE,
} from "@/lib/identity/session";

beforeEach(() => {
  process.env.ACCESS_SECRET = "секрет-подлиннее-шестнадцати";
});

afterEach(() => {
  delete process.env.ACCESS_SECRET;
});

describe("кука сессии", () => {
  it("выпущенная кука читается обратно", () => {
    const cookie = issueSessionCookie(42);

    expect(cookie.name).toBe(SESSION_COOKIE);
    expect(verifySessionValue(cookie.value)).toBe(42);
  });

  it("подделанный номер аккаунта не проходит", () => {
    const cookie = issueSessionCookie(42);
    const [, exp, sig] = cookie.value.split(".");

    expect(verifySessionValue(`43.${exp}.${sig}`)).toBeNull();
  });

  it("протухшая кука не проходит", () => {
    const past = Math.floor(Date.now() / 1000) - 10;
    // Подпись верна для пары (42, past), но срок вышел — важно, что решает именно срок.
    const sig = crypto
      .createHmac("sha256", process.env.ACCESS_SECRET!)
      .update(`42:${past}`)
      .digest("hex");

    expect(verifySessionValue(`42.${past}.${sig}`)).toBeNull();
  });

  it("мусор вместо куки не роняет проверку", () => {
    expect(verifySessionValue(undefined)).toBeNull();
    expect(verifySessionValue("")).toBeNull();
    expect(verifySessionValue("не.кука")).toBeNull();
  });
});

describe("чтение куки по имени", () => {
  it("находит куку среди прочих", () => {
    expect(readCookie("a=1; gt_session=знач; b=2", SESSION_COOKIE)).toBe("знач");
  });

  it("кука с похожим именем настоящей не считается", () => {
    // xgt_session — не gt_session. Регулярка без границы имени считала бы
    // иначе, и любой, кто умеет поставить куку с длинным именем, подменял бы
    // значение, на котором держится «кто вошёл».
    expect(readCookie("xgt_session=чужое", SESSION_COOKIE)).toBeNull();
  });
});
