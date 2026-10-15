import { describe, expect, it } from "vitest";
import { categoryEmoji, matchesQuery, stockStatus } from "@/lib/catalogue";
import { changeDue, parseAmount, quickCashAmounts } from "@/lib/cash";

describe("cash helpers", () => {
  it("parses typed amounts and treats empty input as unset", () => {
    expect(parseAmount("50.000")).toBe(50000);
    expect(parseAmount("Rp 100,000")).toBe(100000);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
  });

  it("never reports negative change", () => {
    expect(changeDue(28000, 50000)).toBe(22000);
    expect(changeDue(28000, 20000)).toBe(0);
  });

  it("offers exact plus rounded-up amounts in ascending order", () => {
    expect(quickCashAmounts(28000)).toEqual([28000, 30000, 50000, 100000]);
    expect(quickCashAmounts(50000)).toEqual([50000, 100000]);
    expect(quickCashAmounts(0)).toEqual([]);
    expect(quickCashAmounts(28000).length).toBeLessThanOrEqual(4);
  });
});

describe("catalogue helpers", () => {
  it("classifies stock levels", () => {
    expect(stockStatus(0)).toBe("out");
    expect(stockStatus(-2)).toBe("out");
    expect(stockStatus(4)).toBe("low");
    expect(stockStatus(5)).toBe("ok");
  });

  it("matches name or sku case-insensitively", () => {
    const item = { name: "Flat White", sku: "COF-001" };
    expect(matchesQuery(item, "flat")).toBe(true);
    expect(matchesQuery(item, "cof-0")).toBe(true);
    expect(matchesQuery(item, "tea")).toBe(false);
    expect(matchesQuery(item, "  ")).toBe(true);
  });

  it("picks an emoji by category", () => {
    expect(categoryEmoji("Coffee")).toBe("☕");
    expect(categoryEmoji("Green Tea")).toBe("🍵");
    expect(categoryEmoji("Food")).toBe("🥐");
  });
});
