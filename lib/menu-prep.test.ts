import { describe, expect, it } from "vitest";
import { missingMenuItems, PREP_MENU } from "@/lib/menu-prep";

describe("Prep. starter menu", () => {
  it("has unique SKUs and the 13 wall items", () => {
    expect(new Set(PREP_MENU.map((i) => i.sku)).size).toBe(PREP_MENU.length);
    expect(PREP_MENU).toHaveLength(13);
  });

  it("only offers items not already in the catalogue, matching SKU case-insensitively", () => {
    const missing = missingMenuItems([{ sku: "cof-001" }, { sku: "NC-002" }]);
    expect(missing.map((i) => i.sku)).not.toContain("COF-001");
    expect(missing.map((i) => i.sku)).not.toContain("NC-002");
    expect(missing).toHaveLength(11);
  });
});
