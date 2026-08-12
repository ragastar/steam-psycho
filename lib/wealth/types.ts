import type { InventoryStatus } from "@/lib/wealth/inventory";

export interface WealthItem {
  name: string;
  qty: number;
  /** Цена одной штуки в рублях, уже округлённая. */
  unitRub: number;
  /** Стоимость всей стопки (qty × цена штуки), уже округлённая. Топ сортируется по этому полю, не по unitRub. */
  totalRub: number;
}

export interface Wealth {
  currency: "RUB";
  /** Библиотека плюс инвентарь. */
  total: number;
  /**
   * Библиотека. `null` — разбор сделан до перехода на единую рублёвую базу
   * (у его экономики нет метки валюты): считать по нему нечего, а пересчёт
   * прежней смешанной суммы по курсу давал на витрине миллионы из воздуха.
   * Появится сам, когда разбор пересчитают.
   */
  library: {
    total: number;
    avgPrice: number;
    perHour: number;
    /** Часть суммы достроена по средней цене — это надо подписать на витрине. */
    estimated: boolean;
    unknownGames: number;
  } | null;
  /** Отсутствует по той же причине, что и `library`. */
  unplayed: {
    value: number;
  } | null;
  inventory: {
    status: InventoryStatus;
    total: number;
    itemCount: number;
    top: WealthItem[];
    /** Невыставляемые вещи: в сумму не идут, но говорят о человеке. */
    notable: string[];
    /** Карточки и эмоции посчитаны по средней цене, а не по рынку. */
    cardsEstimated: number;
    /**
     * Выставляемые предметы (CS2/Dota/TF2 это не редкость), которых нет в
     * прайс-листе рынка: штук, а не рубли — деньги за них не посчитаны и
     * в total не входят, но и пропадать с витрины молча они не должны.
     */
    unpricedItems: number;
  };
  /** Полный расчёт хранится долго, неполный — час. */
  complete: boolean;
}
