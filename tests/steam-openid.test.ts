import { describe, it, expect, afterEach, vi } from "vitest";
import { buildAuthUrl, verifyAssertion } from "@/lib/identity/steam-openid";

afterEach(() => {
  vi.restoreAllMocks();
});

function assertion(claimedId: string): URLSearchParams {
  return new URLSearchParams({
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "id_res",
    "openid.claimed_id": claimedId,
    "openid.identity": claimedId,
    "openid.sig": "подпись",
    "openid.signed": "signed,op_endpoint,claimed_id,identity",
  });
}

describe("вход через Steam", () => {
  it("ссылка ведёт на Steam и просит выбрать личность", () => {
    const url = new URL(buildAuthUrl("https://zadrotometr.ru/api/auth/steam/callback", "https://zadrotometr.ru"));

    expect(url.origin + url.pathname).toBe("https://steamcommunity.com/openid/login");
    expect(url.searchParams.get("openid.mode")).toBe("checkid_setup");
    expect(url.searchParams.get("openid.claimed_id")).toBe(
      "http://specs.openid.net/auth/2.0/identifier_select",
    );
    expect(url.searchParams.get("openid.return_to")).toBe(
      "https://zadrotometr.ru/api/auth/steam/callback",
    );
  });

  it("подтверждённый ответ отдаёт steamId", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "ns:http://specs.openid.net/auth/2.0\nis_valid:true\n",
    }));

    const steamId = await verifyAssertion(
      assertion("https://steamcommunity.com/openid/id/76561197990915489"),
    );

    expect(steamId).toBe("76561197990915489");
  });

  it("неподтверждённый ответ не даёт ничего", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "ns:http://specs.openid.net/auth/2.0\nis_valid:false\n",
    }));

    expect(
      await verifyAssertion(assertion("https://steamcommunity.com/openid/id/76561197990915489")),
    ).toBeNull();
  });

  it("чужой адрес личности не принимается даже при is_valid", async () => {
    // Без этой проверки любой, кто поднимет свой OpenID-сервер, назовётся
    // владельцем чужого Steam-аккаунта.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "is_valid:true\n",
    }));

    expect(await verifyAssertion(assertion("https://evil.example/openid/id/76561197990915489")))
      .toBeNull();
  });

  it("сеть упала — отказ, а не пропуск", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("нет сети")));

    expect(
      await verifyAssertion(assertion("https://steamcommunity.com/openid/id/76561197990915489")),
    ).toBeNull();
  });
});
