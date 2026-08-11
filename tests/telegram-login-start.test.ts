import { describe, it, expect, afterEach, vi } from "vitest";
import { handleLoginStart } from "@/lib/telegram/handlers";
import { getCache, setCache, deleteCache } from "@/lib/cache/redis";
import { loginTokenKey } from "@/lib/cache/keys";

interface LoginToken {
  status: string;
  telegramUserId?: string;
}

const TOKEN = "тк-подтверждения";

afterEach(async () => {
  await deleteCache(loginTokenKey(TOKEN));
});

describe("подтверждение входа ботом", () => {
  it("неизвестный токен не подтверждается и в кеше не заводится", async () => {
    expect(await handleLoginStart(111, TOKEN)).toBe("expired");
    expect(await getCache<LoginToken>(loginTokenKey(TOKEN))).toBeNull();
  });

  it("ожидающий токен подтверждается и запоминает, кто нажал Start", async () => {
    await setCache(loginTokenKey(TOKEN), { status: "pending" }, 600);

    expect(await handleLoginStart(111, TOKEN)).toBe("ok");

    const data = await getCache<LoginToken>(loginTokenKey(TOKEN));
    expect(data).toEqual({ status: "confirmed", telegramUserId: "111" });
  });

  it("уже подтверждённый токен вторым нажатием не перебивается", async () => {
    // Иначе последний нажавший Start подменяет собой предыдущего (и заодно
    // продлевает срок жизни токена): чужое подтверждение перебивается своим.
    await setCache(loginTokenKey(TOKEN), { status: "pending" }, 600);
    await handleLoginStart(111, TOKEN);

    expect(await handleLoginStart(222, TOKEN)).toBe("expired");

    const data = await getCache<LoginToken>(loginTokenKey(TOKEN));
    expect(data).toEqual({ status: "confirmed", telegramUserId: "111" });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
