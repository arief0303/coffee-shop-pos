import { NextResponse } from "next/server";
import { readProductsFromSheets } from "@/lib/google-sheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const products = await readProductsFromSheets();
    return NextResponse.json({ products });
  } catch (error) {
    console.error("Product pull failed", error);
    return NextResponse.json(
      { error: "Google Sheets is not configured or unavailable" },
      { status: 503 },
    );
  }
}
