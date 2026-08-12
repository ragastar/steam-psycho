import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import ru from "@/messages/ru.json";
import en from "@/messages/en.json";

const page = readFileSync("app/[locale]/result/[id]/page.tsx", "utf8");
const tabs = readFileSync("components/ResultTabs.tsx", "utf8");

describe("витрина кошелька", () => {
  it("кошелёк считается только при полном доступе", () => {
    // Расчёт стоит ПОСЛЕ ветки, которая отдаёт бесплатный вид: до неё он гонял
    // бы четыре запроса в Steam на каждого посетителя, включая неплательщиков.
    const free = page.indexOf('access !== "full"');
    const wealth = page.indexOf("getWealth(");
    expect(free).toBeGreaterThan(-1);
    expect(wealth).toBeGreaterThan(free);
  });

  it("бесплатный вид кошелька не получает", () => {
    const freeBlock = page.slice(page.indexOf("<FreeResult"), page.indexOf("/>", page.indexOf("<FreeResult")));
    expect(freeBlock).not.toContain("wealth");
  });

  it("витрина живёт во вкладке глубокого погружения", () => {
    expect(tabs).toContain("WealthCard");
  });

  it("подписи есть на обоих языках", () => {
    for (const messages of [ru, en]) {
      const wealth = (messages as Record<string, Record<string, unknown>>).deepDive.wealth as Record<string, string>;
      for (const key of ["title", "library", "inventory", "unplayed", "perHour", "avgPrice",
                         "marketNote", "estimatedNote", "privateInventory", "cards"]) {
        expect(wealth[key]).toBeTruthy();
      }
    }
  });
});
