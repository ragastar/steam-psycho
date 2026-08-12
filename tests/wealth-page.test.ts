import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ru from "@/messages/ru.json";
import en from "@/messages/en.json";
import { WealthCard } from "@/components/DeepDive/WealthCard";
import type { Wealth } from "@/lib/wealth/types";

const page = readFileSync("app/[locale]/result/[id]/page.tsx", "utf8");
const tabs = readFileSync("components/ResultTabs.tsx", "utf8");

// Инвентарь без единого выставляемого предмета (qty=0 по всем прайсуемым
// приложениям) — минимальный валидный Wealth для проверки подписей.
function makeWealth(status: Wealth["inventory"]["status"]): Wealth {
  return {
    currency: "RUB",
    total: 1000,
    library: { total: 800, avgPrice: 100, perHour: 50, estimated: false, unknownGames: 0 },
    unplayed: { value: 100 },
    inventory: {
      status,
      total: 0,
      itemCount: 0,
      top: [],
      notable: [],
      cardsEstimated: 0,
      unpricedItems: 0,
    },
    complete: false,
  };
}

const labels = {
  title: "T",
  accountValue: "AV",
  library: "L",
  inventory: "I",
  unplayed: "U",
  perHour: "PH",
  avgPrice: "AP",
  cards: "C",
  notable: "N",
  unpricedCount: "UC",
  unpricedNote: "UN",
  marketNote: "MARKET_NOTE_MARKER",
  estimatedNote: "EN",
  privateInventory: "PRIVATE_MARKER",
  inventoryUnavailable: "UNAVAILABLE_MARKER",
  storeNote: "SN",
};

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
                         "marketNote", "estimatedNote", "privateInventory", "cards",
                         "unpricedCount", "unpricedNote", "inventoryUnavailable"]) {
        expect(wealth[key]).toBeTruthy();
      }
    }
  });

  it("недоступный инвентарь не подписывается как оценённый по рынку", () => {
    // status "unavailable" — Steam не ответил / лимит / оборвалась связь, а не
    // приватность. Число уже честно показывает прочерк («ok» проверяется
    // отдельно), но подпись раньше молчала об этом и писала «оценён по рынку» —
    // ложное утверждение на платной странице про деньги.
    const html = renderToStaticMarkup(createElement(WealthCard, { wealth: makeWealth("unavailable"), labels }));
    expect(html).toContain("UNAVAILABLE_MARKER");
    expect(html).not.toContain("MARKET_NOTE_MARKER");
  });

  it("приватный инвентарь по-прежнему получает свою подпись", () => {
    const html = renderToStaticMarkup(createElement(WealthCard, { wealth: makeWealth("private"), labels }));
    expect(html).toContain("PRIVATE_MARKER");
    expect(html).not.toContain("MARKET_NOTE_MARKER");
    expect(html).not.toContain("UNAVAILABLE_MARKER");
  });

  it("доступный инвентарь получает рыночную подпись", () => {
    const html = renderToStaticMarkup(createElement(WealthCard, { wealth: makeWealth("ok"), labels }));
    expect(html).toContain("MARKET_NOTE_MARKER");
    expect(html).not.toContain("PRIVATE_MARKER");
    expect(html).not.toContain("UNAVAILABLE_MARKER");
  });
});
