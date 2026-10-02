import {
  getPendingOperations,
  mergeProductsFromServer,
  removePendingOperation,
} from "@/lib/local-db";
import type { Product } from "@/lib/sync-protocol";
import { MAX_SYNC_OPERATIONS } from "@/lib/sync-protocol";

export async function pullProducts(): Promise<Product[]> {
  const response = await fetch("/api/products", { cache: "no-store" });
  if (!response.ok) throw new Error("Google Sheets product pull failed");
  const body = (await response.json()) as { products: Product[] };
  return mergeProductsFromServer(body.products);
}

export async function pushPendingOperations(): Promise<number> {
  const pending = await getPendingOperations();
  let pushed = 0;

  for (let start = 0; start < pending.length; start += MAX_SYNC_OPERATIONS) {
    const batch = pending.slice(start, start + MAX_SYNC_OPERATIONS);
    const response = await fetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operations: batch.map((record) => record.operation) }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? "Google Sheets sync failed");
    }

    for (const record of batch) await removePendingOperation(record.id);
    pushed += batch.length;
  }

  return pushed;
}

export async function syncNow(): Promise<{ pushed: number; products: Product[] }> {
  const pushed = await pushPendingOperations();
  const products = await pullProducts();
  return { pushed, products };
}
