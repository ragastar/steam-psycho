import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildAggregatedProfile } from "@/lib/aggregation/aggregate";
import { portraitFixture, lockedStrings, player, game, noBadges, noAchievements, noRecent } from "./fixtures";

/**
 * Картинку карточки отдаёт `/api/og/[id]` — по одной ссылке, кому угодно, без
 * входа и без проверки права. Значит нарисовано в ней может быть только
 * бесплатное. Проверяем не байты PNG, а дерево, которое уходит в отрисовку:
 * что нарисуется, решает именно оно, а сравнивать картинки попиксельно —
 * проверять шрифты вместо доступа.
 */
const drawnTrees: unknown[] = [];

vi.mock("satori", () => ({
  default: (tree: unknown) => {
    drawnTrees.push(tree);
    return Promise.resolve("<svg></svg>");
  },
}));

vi.mock("@resvg/resvg-js", () => ({
  Resvg: class {
    render() {
      return { asPng: () => Buffer.from("png") };
    }
  },
}));

// Настоящий рендер тянет шрифт из сети. В тесте сети быть не должно.
vi.stubGlobal("fetch", async () => ({ arrayBuffer: async () => new ArrayBuffer(8) }));

const { renderCardPng } = await import("@/lib/card/render");

const profile = buildAggregatedProfile(
  player(),
  [game({ name: "Секретная игра" })],
  noRecent,
  10,
  [],
  noBadges,
  noAchievements,
);

/** Весь текст, который дерево просит нарисовать. */
function drawnText(node: unknown, out: string[] = []): string[] {
  if (node === null || node === undefined || typeof node === "boolean") return out;
  if (typeof node === "string" || typeof node === "number") {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) drawnText(child, out);
    return out;
  }
  if (typeof node === "object") {
    const props = (node as { props?: { children?: unknown } }).props;
    if (props) drawnText(props.children, out);
  }
  return out;
}

describe("картинка карточки не рисует платное (MON-2)", () => {
  beforeEach(() => {
    drawnTrees.length = 0;
  });

  it("ГЛАВНОЕ: ни одно закрытое слово не попадает в картинку", async () => {
    const portrait = portraitFixture();
    await renderCardPng(portrait, profile);

    const text = drawnText(drawnTrees[0]).join("\n");
    for (const secret of lockedStrings(portrait)) {
      expect(text).not.toContain(secret);
    }
  });

  it("рисует бесплатный роаст — самый суровый, а не первый попавшийся", async () => {
    const portrait = portraitFixture();
    await renderCardPng(portrait, profile);

    const text = drawnText(drawnTrees[0]).join("\n");
    // В фикстуре critical стоит третьим: первый роаст платный, и раньше
    // рисовался именно он.
    expect(text).toContain(portrait.roasts[2].text);
    expect(text).not.toContain(portrait.roasts[0].text);
  });

  it("рисует бесплатную часть: архетип, титул, редкость, игру души", async () => {
    const portrait = portraitFixture();
    await renderCardPng(portrait, profile);

    const text = drawnText(drawnTrees[0]).join("\n");
    expect(text).toContain(portrait.primaryArchetype.name);
    expect(text).toContain(portrait.title);
    expect(text).toContain(portrait.rarity);
    expect(text).toContain(portrait.spirit_game);
  });

  it("не падает на карточке без роастов", async () => {
    const portrait = { ...portraitFixture(), roasts: [] };
    await expect(renderCardPng(portrait, profile)).resolves.toBeDefined();
  });
});
