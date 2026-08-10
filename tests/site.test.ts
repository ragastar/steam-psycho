import { describe, it, expect } from "vitest";
import { siteHost, SITE_HOST, SITE_URL } from "../lib/site";

describe("адрес сайта", () => {
  it("срезает протокол", () => {
    expect(siteHost("https://zadrotometr.ru")).toBe("zadrotometr.ru");
    expect(siteHost("http://zadrotometr.ru")).toBe("zadrotometr.ru");
  });

  it("срезает хвостовые слэши", () => {
    expect(siteHost("https://zadrotometr.ru/")).toBe("zadrotometr.ru");
    expect(siteHost("https://zadrotometr.ru///")).toBe("zadrotometr.ru");
  });

  it("не трогает поддомен и порт", () => {
    expect(siteHost("https://www.zadrotometr.ru:8443")).toBe("www.zadrotometr.ru:8443");
  });

  // Мёртвый домен был вписан руками в подпись на карточке, в подпись на превью
  // для соцсетей и дважды в приветствие бота. Переезд их не затронул.
  it("нигде не остаётся мёртвого домена по умолчанию", () => {
    expect(SITE_URL).not.toContain("gamertype.fun");
    expect(SITE_HOST).not.toContain("gamertype.fun");
  });
});
