import { describe, it, expect } from "vitest";
import { buildAggregatedProfile, calculateCardStats, calculateRarity } from "@/lib/aggregation/aggregate";
import { buildUserPrompt, getSystemPrompt } from "@/lib/llm/prompt";
import type { CardIdentity } from "@/lib/art/card-identity";
import type { EnrichedGame } from "@/lib/steam/types";
import { player, noBadges, noAchievements, noRecent } from "./fixtures";

const game: EnrichedGame = {
  appid: 1,
  name: "Game 1",
  playtime_forever: 600,
  img_icon_url: "icon",
  tags: {},
  genres: [],
  price: 1200,
  isFree: false,
  enriched: true,
  priceSource: "ru",
};

function promptFor(identity: CardIdentity): string {
  const profile = buildAggregatedProfile(player(), [game], noRecent, 10, [], noBadges, noAchievements);
  const stats = calculateCardStats(profile);
  return buildUserPrompt(profile, stats, calculateRarity(profile, null), identity);
}

const identity = (over: Partial<CardIdentity> = {}): CardIdentity => ({
  creatureClass: "cephalopods",
  element: "void",
  palette: "snow",
  ...over,
});

describe("ограничения для духа в промпте", () => {
  it("требует существо именно из выбранного класса", () => {
    expect(promptFor(identity())).toContain("cephalopod");
    expect(promptFor(identity({ creatureClass: "livestock" }))).toContain("livestock");
  });

  it("перечисляет запрещённые штампы", () => {
    // Ровно те образы, которые модель выдавала снова и снова: восемь духов из
    // пятнадцати были грызунами, три из них — хомяк в колесе.
    const prompt = promptFor(identity()).toLowerCase();
    for (const cliche of ["hamster", "skinner", "sloth", "raccoon"]) {
      expect(prompt).toContain(cliche);
    }
  });

  it("запрещает человека и комнату с мониторами в сцене", () => {
    const prompt = promptFor(identity()).toLowerCase();
    expect(prompt).toContain("no humans");
    expect(prompt).toContain("monitor");
  });

  it("передаёт модели свет карточки, чтобы текст сцены с ним не спорил", () => {
    expect(promptFor(identity({ palette: "snow" }))).toContain("whiteout snowfall");
    expect(promptFor(identity({ palette: "desertHeat" }))).toContain("heat shimmer");
  });

  it("системный промпт больше не зовёт выдумывать ЛЮБОЕ существо", () => {
    // Именно эта строчка и отправляла модель в её самый вероятный образ.
    for (const locale of ["ru", "en"]) {
      const system = getSystemPrompt(locale);
      expect(system).not.toContain("ЛЮБОЕ существо");
      expect(system).not.toContain("ANY creature");
    }
  });
});
