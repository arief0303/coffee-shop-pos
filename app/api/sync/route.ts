import { NextResponse } from "next/server";
import { appendSaleIfMissing, upsertProductInSheets } from "@/lib/google-sheets";
import { validateSyncBatch } from "@/lib/sync-protocol";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const batch = validateSyncBatch(await request.json());
    const results = [];

    for (const operation of batch.operations) {
      if (operation.type === "sale.create") {
        results.push({
          id: operation.id,
          type: operation.type,
          result: await appendSaleIfMissing(operation.payload.sale),
        });
      } else {
        results.push({
          id: operation.id,
          type: operation.type,
          result: await upsertProductInSheets(operation.payload.product),
        });
      }
    }

    return NextResponse.json({ accepted: results.length, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed";
    console.error("Sync failed", error);
    const status = message.startsWith("Missing GOOGLE_") || message.includes("Google") ? 503 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
