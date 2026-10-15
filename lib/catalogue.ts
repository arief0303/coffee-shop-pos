export const LOW_STOCK_THRESHOLD = 5;

export type StockStatus = "out" | "low" | "ok";

export function stockStatus(stock: number): StockStatus {
  if (stock <= 0) return "out";
  return stock < LOW_STOCK_THRESHOLD ? "low" : "ok";
}

export function categoryEmoji(category: string): string {
  const value = category.toLowerCase();
  if (value.includes("coffee")) return "☕";
  if (value.includes("tea")) return "🍵";
  return "🥐";
}

export function matchesQuery(product: { name: string; sku: string }, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  return !normalized || product.name.toLowerCase().includes(normalized) || product.sku.toLowerCase().includes(normalized);
}
