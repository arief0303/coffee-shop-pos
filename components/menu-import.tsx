"use client";

import { useMemo, useState } from "react";
import { MADE_TO_ORDER_STOCK, missingMenuItems } from "@/lib/menu-prep";
import type { Product } from "@/lib/sync-protocol";

type Props = { products: Product[]; onImport: (items: Array<{ name: string; sku: string; category: string; price: number }>) => Promise<void> };

/** One-tap import of the Prep. wall menu; the owner types each price once, on the device. */
export function MenuImport({ products, onImport }: Props) {
  const missing = useMemo(() => missingMenuItems(products), [products]);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!missing.length) return null;

  const ready = missing.filter((item) => /^\d+$/.test(prices[item.sku] ?? "") );

  async function submit() {
    setBusy(true);
    try {
      await onImport(ready.map((item) => ({ ...item, price: Number(prices[item.sku]) })));
      setPrices({});
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="inventory-form menu-import" aria-labelledby="menu-import-heading">
      <div className="qris-slot-head">
        <h2 id="menu-import-heading">Prep. menu</h2>
        <button type="button" className="text-button" onClick={() => setOpen((value) => !value)}>{open ? "Hide" : `Add ${missing.length} items`}</button>
      </div>
      {open && (
        <>
          <p className="form-note">Type a price for each drink, then add them in one go. Items without a price are skipped. Stock is set to {MADE_TO_ORDER_STOCK} (made to order).</p>
          {missing.map((item) => (
            <label className="menu-import-row" key={item.sku}>
              <span><b>{item.name}</b><small>{item.sku} · {item.category}</small></span>
              <input inputMode="numeric" placeholder="Rp" value={prices[item.sku] ?? ""} onChange={(event) => setPrices((current) => ({ ...current, [item.sku]: event.target.value.replace(/\D/g, "") }))} aria-label={`Price for ${item.name}`} />
            </label>
          ))}
          <div className="form-actions">
            <button type="button" className="primary-button" disabled={!ready.length || busy} onClick={() => void submit()}>{busy ? "Adding..." : `Add ${ready.length} priced item${ready.length === 1 ? "" : "s"}`}</button>
          </div>
        </>
      )}
    </section>
  );
}
