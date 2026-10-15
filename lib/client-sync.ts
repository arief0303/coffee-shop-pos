import {
  getPendingOperations,
  mergeProductsFromServer,
  removePendingOperation,
} from "@/lib/local-db";
import type { Product } from "@/lib/sync-protocol";
import { MAX_SYNC_OPERATIONS } from "@/lib/sync-protocol";

/** An expired session returns 401; send the user back to sign in instead of showing a vague sync error. */
function redirectIfSignedOut(response: Response): void {
  // Full navigation on purpose: the sign-in flow must start from a fresh document.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  if (response.status === 401 && typeof window !== "undefined") window.location.href = "/login";
}

export async function pullProducts(): Promise<Product[]> {
  const response = await fetch("/api/products", { cache: "no-store" });
  redirectIfSignedOut(response);
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
    redirectIfSignedOut(response);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      const missingSetup = body?.error?.startsWith("Missing GOOGLE_");
      throw new Error(
        missingSetup ? "Google Sheets is not set up yet — sales are safe on this device" : (body?.error ?? "Google Sheets sync failed"),
      );
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
