import { describe, expect, it } from "vitest";
import {
  MAX_SYNC_OPERATIONS,
  calculateSaleTotal,
  validateSyncBatch,
} from "@/lib/sync-protocol";
import { identifier } from "@/lib/time";

describe("sync protocol", () => {
  it("accepts a sale operation with a stable idempotency key", () => {
    const batch = {
      operations: [
        {
          id: "op-sale-1",
          type: "sale.create" as const,
          payload: {
            sale: {
              id: "sale-1",
              items: [
                { productId: "p-1", name: "Coffee", quantity: 2, price: 15000 },
              ],
              total: 30000,
              paymentMethod: "cash" as const,
              timestamp: 1700000000000,
            },
          },
        },
      ],
    };

    expect(validateSyncBatch(batch)).toEqual(batch);
  });

  it("rejects a sale when the total does not match its line items", () => {
    expect(() =>
      validateSyncBatch({
        operations: [
          {
            id: "op-sale-1",
            type: "sale.create",
            payload: {
              sale: {
                id: "sale-1",
                items: [{ productId: "p-1", name: "Coffee", quantity: 2, price: 15000 }],
                total: 1,
                paymentMethod: "cash",
                timestamp: 1700000000000,
              },
            },
          },
        ],
      }),
    ).toThrow("Sale total does not match line items");
  });

  it("rejects batches larger than the serverless request limit", () => {
    const operations = Array.from({ length: MAX_SYNC_OPERATIONS + 1 }, (_, index) => ({
      id: `op-${index}`,
      type: "sale.create" as const,
      payload: {
        sale: {
          id: `sale-${index}`,
          items: [{ productId: "p-1", name: "Coffee", quantity: 1, price: 1000 }],
          total: 1000,
          paymentMethod: "cash" as const,
          timestamp: 1700000000000,
        },
      },
    }));

    expect(() => validateSyncBatch({ operations })).toThrow("Too many operations");
  });

  it("creates an id when Web Crypto is unavailable on an HTTP origin", () => {
    const originalCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: undefined });
    try {
      expect(identifier()).toMatch(/^[a-z0-9-]+$/);
    } finally {
      Object.defineProperty(globalThis, "crypto", { configurable: true, value: originalCrypto });
    }
  });

  it("calculates totals using integer IDR values", () => {
    expect(
      calculateSaleTotal([
        { productId: "p-1", name: "Coffee", quantity: 2, price: 15000 },
        { productId: "p-2", name: "Tea", quantity: 1, price: 7000 },
      ]),
    ).toBe(37000);
  });
});

describe("QRIS payments", () => {
  const items = [{ productId: "p1", name: "Flat white", quantity: 1, price: 28000 }];
  const sale = (extra: Record<string, unknown>) => ({
    operations: [{ id: "op1", type: "sale.create", payload: { sale: { id: "s1", items, total: 28000, timestamp: 1_700_000_000_000, ...extra } } }],
  });

  it("accepts a QRIS sale for each supported account", () => {
    for (const paymentProvider of ["bri", "gopay", "bca", "other"]) {
      expect(validateSyncBatch(sale({ paymentMethod: "qris", paymentProvider })).operations).toHaveLength(1);
    }
  });

  it("accepts an optional reference", () => {
    expect(validateSyncBatch(sale({ paymentMethod: "qris", paymentProvider: "bri", paymentRef: "033265" })).operations).toHaveLength(1);
  });

  it("requires a known provider for QRIS", () => {
    expect(() => validateSyncBatch(sale({ paymentMethod: "qris" }))).toThrow("QRIS sales need a supported account");
    expect(() => validateSyncBatch(sale({ paymentMethod: "qris", paymentProvider: "ovo" }))).toThrow("QRIS sales need a supported account");
  });

  it("rejects unknown payment methods and oversized references", () => {
    expect(() => validateSyncBatch(sale({ paymentMethod: "card" }))).toThrow("Unsupported payment method");
    expect(() => validateSyncBatch(sale({ paymentMethod: "qris", paymentProvider: "bri", paymentRef: "x".repeat(65) }))).toThrow("Payment reference is invalid");
  });
});
