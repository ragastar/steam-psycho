import { describe, it, expect } from "vitest";
import { percentileRank } from "@/lib/aggregation/percentile";

describe("перцентиль по реальной выборке (DATA-3)", () => {
  const sample = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

  it("значение выше всех даёт 100", () => {
    expect(percentileRank(sample, 200)).toBe(100);
  });

  it("значение ниже всех даёт 0", () => {
    expect(percentileRank(sample, 1)).toBe(0);
  });

  it("середина выборки даёт примерно половину", () => {
    expect(percentileRank(sample, 55)).toBe(50);
  });

  it("не падает на пустой выборке", () => {
    expect(percentileRank([], 42)).toBe(0);
  });

  it("одинаковые значения не считаются «ниже»", () => {
    expect(percentileRank([5, 5, 5, 5], 5)).toBe(0);
  });
});
