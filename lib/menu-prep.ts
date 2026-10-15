import type { Product } from "@/lib/sync-protocol";

/** Prep.'s wall menu. Prices are set by the owner on import; drinks are made to order so stock is a large number. */
export const PREP_MENU: ReadonlyArray<{ name: string; sku: string; category: string }> = [
  { name: "Americano / Long Black", sku: "COF-001", category: "Coffee" },
  { name: "Cappuccino / Latte", sku: "COF-002", category: "Coffee" },
  { name: "Piccolo / Cortado", sku: "COF-003", category: "Coffee" },
  { name: "Magic / Flat White", sku: "COF-004", category: "Coffee" },
  { name: "Swiss Latte", sku: "COF-005", category: "Coffee" },
  { name: "Butterscotch Latte", sku: "COF-006", category: "Coffee" },
  { name: "Signature Eskosu Prep.", sku: "COF-007", category: "Coffee" },
  { name: "Pour Over V60 / Japanese", sku: "COF-008", category: "Coffee" },
  { name: "Earl Grey Milk Tea", sku: "NC-001", category: "Non Coffee" },
  { name: "Uji Matcha", sku: "NC-002", category: "Non Coffee" },
  { name: "Charcoal", sku: "NC-003", category: "Non Coffee" },
  { name: "Chocolate", sku: "NC-004", category: "Non Coffee" },
  { name: "Oat Milk (plant-based)", sku: "EXT-001", category: "Extras" },
];

export const MADE_TO_ORDER_STOCK = 999;

/** Menu entries whose SKU is not already in the catalogue. */
export function missingMenuItems(existing: Pick<Product, "sku">[]): typeof PREP_MENU {
  const skus = new Set(existing.map((item) => item.sku.toUpperCase()));
  return PREP_MENU.filter((item) => !skus.has(item.sku));
}
