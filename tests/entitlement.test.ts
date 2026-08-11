import { describe, it, expect, beforeAll } from "vitest";
import { createHmac } from "crypto";
import { issueAccessCookie, verifyAccessValue } from "@/lib/access/entitlement";

const STEAM_ID = "76561198000000001";
const OTHER_ID = "76561198000000002";

beforeAll(() => {
  process.env.ACCESS_SECRET = "test-secret-at-least-16-chars-long";
});

describe("подписанный доступ (MON-1, MON-2)", () => {
  it("принимает свою же куку", () => {
    const { value } = issueAccessCookie(STEAM_ID);
    expect(verifyAccessValue(STEAM_ID, value)).toBe(true);
  });

  it("не даёт переклеить куку на чужой профиль", () => {
    const { value } = issueAccessCookie(STEAM_ID);
    expect(verifyAccessValue(OTHER_ID, value)).toBe(false);
  });

  it("отвергает подделанную подпись", () => {
    const { value } = issueAccessCookie(STEAM_ID);
    const [exp] = value.split(".");
    expect(verifyAccessValue(STEAM_ID, `${exp}.${"0".repeat(64)}`)).toBe(false);
  });

  it("отвергает просроченную куку, даже с верной подписью", () => {
    // Подпись валидна для этой пары, но срок в прошлом.
    const past = Math.floor(Date.now() / 1000) - 10;
    const sig = createHmac("sha256", process.env.ACCESS_SECRET!)
      .update(`${STEAM_ID}:${past}`)
      .digest("hex");
    expect(verifyAccessValue(STEAM_ID, `${past}.${sig}`)).toBe(false);
  });

  it("отвергает мусор и пустое значение", () => {
    expect(verifyAccessValue(STEAM_ID, undefined)).toBe(false);
    expect(verifyAccessValue(STEAM_ID, "")).toBe(false);
    expect(verifyAccessValue(STEAM_ID, "нет-точки")).toBe(false);
    expect(verifyAccessValue(STEAM_ID, "abc.def")).toBe(false);
  });

  it("кука закрыта от скриптов", () => {
    const { options } = issueAccessCookie(STEAM_ID);
    expect(options.httpOnly).toBe(true);
  });
});
