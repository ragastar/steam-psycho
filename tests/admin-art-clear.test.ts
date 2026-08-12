import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * «Очистить арт» в админке. Картинка купленного разбора — оплаченный товар:
 * снести её значит и потратить деньги на перерисовку, и подменить человеку
 * карточку, за которую он платил.
 */
const purchased = vi.hoisted(() => new Set<string>());

vi.mock("@/lib/billing/store", () => ({
  steamIdHasEntitlement: (steamId64: string) => purchased.has(steamId64),
}));

let artDir: string;

async function freshRoute() {
  process.env.ART_STORAGE_PATH = artDir;
  process.env.ADMIN_SECRET = "секрет";
  vi.resetModules();
  return import("@/app/api/admin/art/clear/route");
}

const post = (body: unknown) =>
  new Request("http://localhost/api/admin/art/clear", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  artDir = fs.mkdtempSync(path.join(os.tmpdir(), "art-"));
  purchased.clear();
  for (const id of ["76561198000000001", "76561198000000002"]) {
    fs.writeFileSync(path.join(artDir, `${id}.png`), "картинка");
  }
});

afterEach(() => {
  delete process.env.ART_STORAGE_PATH;
  delete process.env.ADMIN_SECRET;
  vi.resetModules();
});

describe("очистка арта в админке", () => {
  it("картинку купленного разбора не трогает", async () => {
    purchased.add("76561198000000002");
    const route = await freshRoute();

    const res = await route.POST(post({ token: "секрет" }));

    expect(res.status).toBe(200);
    expect(fs.existsSync(path.join(artDir, "76561198000000001.png"))).toBe(false);
    expect(fs.existsSync(path.join(artDir, "76561198000000002.png"))).toBe(true);
    expect(await res.json()).toMatchObject({ deleted: 1, kept: 1 });
  });

  it("по явному требованию сносит всё, включая купленное", async () => {
    purchased.add("76561198000000002");
    const route = await freshRoute();

    await route.POST(post({ token: "секрет", includePurchased: true }));

    expect(fs.readdirSync(artDir)).toHaveLength(0);
  });

  it("без пароля не делает ничего", async () => {
    const route = await freshRoute();

    expect((await route.POST(post({ token: "не тот" }))).status).toBe(401);
    expect(fs.readdirSync(artDir)).toHaveLength(2);
  });
});
