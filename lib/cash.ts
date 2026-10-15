const ROUNDING_STEPS = [5_000, 10_000, 50_000, 100_000];

export function formatRupiah(value: number): string {
  return `Rp ${value.toLocaleString("id-ID")}`;
}

/** Keeps digits only, so "Rp 50.000" and "50000" both become 50000. Empty input returns null. */
export function parseAmount(input: string): number | null {
  const digits = input.replace(/\D/g, "");
  return digits ? Number(digits) : null;
}

export function changeDue(total: number, tendered: number): number {
  return Math.max(0, tendered - total);
}

/** Exact total plus the nearest rounded-up notes a customer is likely to hand over (max 4). */
export function quickCashAmounts(total: number): number[] {
  if (total <= 0) return [];
  const amounts = new Set<number>([total]);
  for (const step of ROUNDING_STEPS) amounts.add(Math.ceil(total / step) * step);
  return [...amounts].sort((a, b) => a - b).slice(0, 4);
}
