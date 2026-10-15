import { describe, expect, it } from "vitest";
import { isAuthRequired } from "@/lib/auth-config";
import { selectProvider } from "@/lib/backup";
import { hasValidBearer } from "@/lib/backup/authorize";
import { backupStamp, buildBackupFiles, csvCell } from "@/lib/backup/snapshot";
import type { Product, Sale } from "@/lib/sync-protocol";

const product: Product = { id: "p1", name: 'Flat "white"', sku: "COF-1", price: 28000, stock: 5, category: "Coffee", updatedAt: 1 };
const sale: Sale = {
  id: "s1",
  items: [{ productId: "p1", name: "Flat white", quantity: 2, price: 28000 }],
  total: 56000,
  paymentMethod: "cash",
  timestamp: Date.UTC(2026, 9, 15, 3, 0, 0),
};

describe("optional sign-in", () => {
  it("requires sign-in by default and only turns off for explicit values", () => {
    expect(isAuthRequired(undefined)).toBe(true);
    expect(isAuthRequired("")).toBe(true);
    expect(isAuthRequired("true")).toBe(true);
    for (const off of ["false", "FALSE", "0", "off", " no "]) expect(isAuthRequired(off)).toBe(false);
  });
});

describe("backup snapshot", () => {
  it("creates filesystem-safe timestamps", () => {
    expect(backupStamp(new Date("2026-10-15T03:04:05.678Z"))).toBe("2026-10-15T03-04-05Z");
  });

  it("escapes csv cells", () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("plain")).toBe("plain");
  });

  it("builds a restorable json plus two csv files", () => {
    const files = buildBackupFiles([product], [sale], new Date("2026-10-15T03:04:05Z"));
    expect(files.map((f) => f.name)).toEqual([
      "bean-counter-2026-10-15T03-04-05Z.json",
      "bean-counter-products-2026-10-15T03-04-05Z.csv",
      "bean-counter-sales-2026-10-15T03-04-05Z.csv",
    ]);
    const json = JSON.parse(files[0].body);
    expect(json.version).toBe(1);
    expect(json.products).toEqual([product]);
    expect(json.sales).toEqual([sale]);
    expect(files[1].body).toContain('"Flat ""white"""');
    expect(files[2].body.split("\n")[0]).toBe("id,timestamp,paymentMethod,total,items");
  });
});

describe("provider selection", () => {
  it("is disabled when unset", () => {
    expect(selectProvider({}).ok).toBe(false);
  });
  it("rejects unknown providers", () => {
    const result = selectProvider({ BACKUP_PROVIDER: "ftp" });
    expect(result.ok).toBe(false);
  });
  it("reports missing settings for vercel blob", () => {
    const result = selectProvider({ BACKUP_PROVIDER: "vercel-blob" });
    expect(result).toEqual({ ok: false, reason: expect.stringContaining("BLOB_READ_WRITE_TOKEN") });
  });
  it("selects vercel blob when configured", () => {
    const result = selectProvider({ BACKUP_PROVIDER: "vercel-blob", BLOB_READ_WRITE_TOKEN: "t" });
    expect(result.ok && result.provider.id).toBe("vercel-blob");
  });
  it("needs oauth values for google drive", () => {
    const missing = selectProvider({ BACKUP_PROVIDER: "google-drive" });
    expect(missing.ok).toBe(false);
    const ready = selectProvider({
      BACKUP_PROVIDER: "google-drive",
      GOOGLE_CLIENT_ID: "a",
      GOOGLE_CLIENT_SECRET: "b",
      GOOGLE_DRIVE_REFRESH_TOKEN: "c",
    });
    expect(ready.ok && ready.provider.id).toBe("google-drive");
  });
});

describe("bearer authorization", () => {
  it("accepts only the exact secret", () => {
    expect(hasValidBearer("Bearer s3cret", "s3cret")).toBe(true);
    expect(hasValidBearer("Bearer wrong!", "s3cret")).toBe(false);
    expect(hasValidBearer("Bearer s3cret", undefined)).toBe(false);
    expect(hasValidBearer(null, "s3cret")).toBe(false);
    expect(hasValidBearer("s3cret", "s3cret")).toBe(false);
  });
});
