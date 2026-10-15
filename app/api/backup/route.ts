import { NextResponse } from "next/server";
import { isAuthRequired } from "@/lib/auth-config";
import { selectProvider } from "@/lib/backup";
import { hasValidBearer } from "@/lib/backup/authorize";
import { buildBackupFiles } from "@/lib/backup/snapshot";
import { readProductsFromSheets, readSalesFromSheets } from "@/lib/google-sheets";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function isAuthorized(request: Request): Promise<boolean> {
  if (hasValidBearer(request.headers.get("authorization"), process.env.CRON_SECRET)) return true;
  // With sign-in disabled, only the bearer secret may trigger a backup.
  if (!isAuthRequired(process.env.AUTH_REQUIRED)) return false;
  return (await getSession()) !== null;
}

export async function GET(request: Request) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  const selection = selectProvider(process.env);
  return selection.ok
    ? NextResponse.json({ ready: true, provider: selection.provider.id })
    : NextResponse.json({ ready: false, reason: selection.reason });
}

export async function POST(request: Request) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const selection = selectProvider(process.env);
  if (!selection.ok) {
    return NextResponse.json({ error: selection.reason }, { status: 503 });
  }

  try {
    const [products, sales] = await Promise.all([readProductsFromSheets(), readSalesFromSheets()]);
    const files = await selection.provider.upload(buildBackupFiles(products, sales), process.env);
    return NextResponse.json({
      provider: selection.provider.id,
      products: products.length,
      sales: sales.length,
      files,
    });
  } catch (error) {
    console.error("Backup failed", error);
    return NextResponse.json({ error: "Backup failed. Check the server logs and provider settings." }, { status: 502 });
  }
}
