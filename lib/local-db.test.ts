import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { deleteSetting, getSetting, saveSale, setSetting } from "@/lib/local-db";

describe("settings store", () => {
  it("round-trips and deletes a value", async () => {
    await setSetting("qris-image:bri", "data:image/png;base64,AAAA");
    expect(await getSetting("qris-image:bri")).toBe("data:image/png;base64,AAAA");
    await deleteSetting("qris-image:bri");
    expect(await getSetting("qris-image:bri")).toBeUndefined();
  });

  it("keeps provider and reference on saved sales", async () => {
    const sale = await saveSale({
      items: [{ productId: "p1", name: "Flat white", quantity: 1, price: 28000 }],
      total: 28000,
      paymentMethod: "qris",
      paymentProvider: "gopay",
      paymentRef: "GPAB12",
      timestamp: 1_700_000_000_000,
    });
    expect(sale.paymentProvider).toBe("gopay");
    expect(sale.paymentRef).toBe("GPAB12");
  });
});
