import type { Product, Sale } from "@/lib/sync-protocol";
import type { BackupFile } from "@/lib/backup/types";

export type Snapshot = {
  version: 1;
  createdAt: string;
  products: Product[];
  sales: Sale[];
};

export function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csv(header: string[], rows: Array<Array<string | number>>): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

export function backupStamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/:/g, "-");
}

/** One restorable JSON snapshot plus two spreadsheet-friendly CSV files. */
export function buildBackupFiles(products: Product[], sales: Sale[], now: Date = new Date()): BackupFile[] {
  const stamp = backupStamp(now);
  const snapshot: Snapshot = { version: 1, createdAt: now.toISOString(), products, sales };

  return [
    {
      name: `bean-counter-${stamp}.json`,
      contentType: "application/json",
      body: JSON.stringify(snapshot, null, 2),
    },
    {
      name: `bean-counter-products-${stamp}.csv`,
      contentType: "text/csv",
      body: csv(
        ["id", "name", "sku", "price", "stock", "category", "updatedAt"],
        products.map((p) => [p.id, p.name, p.sku, p.price, p.stock, p.category, p.updatedAt]),
      ),
    },
    {
      name: `bean-counter-sales-${stamp}.csv`,
      contentType: "text/csv",
      body: csv(
        ["id", "timestamp", "paymentMethod", "total", "items"],
        sales.map((s) => [s.id, new Date(s.timestamp).toISOString(), s.paymentMethod, s.total, JSON.stringify(s.items)]),
      ),
    },
  ];
}
