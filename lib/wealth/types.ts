import type { InventoryStatus } from "@/lib/wealth/inventory";

export interface WealthItem {
  name: string;
  qty: number;
  rub: number;
}

export interface Wealth {
  currency: "RUB";
  /** Библиотека плюс инвентарь. */
  total: number;
  library: {
    total: number;
    avgPrice: number;
    perHour: number;
    /** Часть суммы достроена по средней цене — это надо подписать на витрине. */
    estimated: boolean;
    unknownGames: number;
  };
  unplayed: {
    value: number;
  };
  inventory: {
    status: InventoryStatus;
    total: number;
    itemCount: number;
    top: WealthItem[];
    /** Невыставляемые вещи: в сумму не идут, но говорят о человеке. */
    notable: string[];
    /** Карточки и эмоции посчитаны по средней цене, а не по рынку. */
    cardsEstimated: number;
  };
  /** Полный расчёт хранится долго, неполный — час. */
  complete: boolean;
}
