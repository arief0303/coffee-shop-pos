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
