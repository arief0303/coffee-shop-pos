import { google, sheets_v4 } from "googleapis";
import type { Product, Sale } from "@/lib/sync-protocol";

const PRODUCTS_RANGE = "Products!A:G";
const SALES_RANGE = "Sales!A:F";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function getSheetsClient(): sheets_v4.Sheets {
  const auth = new google.auth.JWT({
    email: requiredEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
    key: requiredEnv("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

function sheetId(): string {
  return requiredEnv("GOOGLE_SHEET_ID");
}

function parseProduct(row: string[]): Product {
  return {
    id: row[0] ?? "",
    name: row[1] ?? "",
    sku: row[2] ?? "",
    price: Number(row[3] ?? 0),
    stock: Number(row[4] ?? 0),
    category: row[5] ?? "",
    updatedAt: Number(row[6] ?? Date.now()),
  };
}

export async function readProductsFromSheets(): Promise<Product[]> {
  const response = await getSheetsClient().spreadsheets.values.get({
    spreadsheetId: sheetId(),
    range: PRODUCTS_RANGE,
  });
  return (response.data.values ?? []).slice(1).filter((row) => row[0]).map(parseProduct);
}

async function readSalesIds(): Promise<Set<string>> {
  const response = await getSheetsClient().spreadsheets.values.get({
    spreadsheetId: sheetId(),
    range: SALES_RANGE,
  });
  return new Set((response.data.values ?? []).slice(1).map((row) => row[0]).filter(Boolean));
}

function productRow(product: Product): string[] {
  return [
    product.id,
    product.name,
    product.sku,
    String(product.price),
    String(product.stock),
    product.category,
    String(product.updatedAt),
  ];
}

export async function upsertProductInSheets(product: Product): Promise<"created" | "updated"> {
  const sheets = getSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId(),
    range: PRODUCTS_RANGE,
  });
  const rows = response.data.values ?? [];
  const rowIndex = rows.findIndex((row) => row[0] === product.id);

  if (rowIndex === -1) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId(),
      range: PRODUCTS_RANGE,
      valueInputOption: "RAW",
      requestBody: { values: [productRow(product)] },
    });
    return "created";
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId(),
    range: `Products!A${rowIndex + 1}:G${rowIndex + 1}`,
    valueInputOption: "RAW",
    requestBody: { values: [productRow(product)] },
  });
  return "updated";
}

export async function appendSaleIfMissing(sale: Sale): Promise<"created" | "duplicate"> {
  if ((await readSalesIds()).has(sale.id)) return "duplicate";
  await getSheetsClient().spreadsheets.values.append({
    spreadsheetId: sheetId(),
    range: SALES_RANGE,
    valueInputOption: "RAW",
    requestBody: {
      values: [[
        sale.id,
        JSON.stringify(sale.items),
        String(sale.total),
        String(sale.timestamp),
        sale.paymentMethod,
        sale.id,
      ]],
    },
  });
  return "created";
}
