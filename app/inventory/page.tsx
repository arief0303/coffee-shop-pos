"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { getProducts, saveProduct } from "@/lib/local-db";
import { pullProducts, pushPendingOperations } from "@/lib/client-sync";
import type { Product } from "@/lib/sync-protocol";
import { identifier, timestamp } from "@/lib/time";

const emptyForm = { name: "", sku: "", price: "", stock: "", category: "Coffee" };
const money = (value: number) => `Rp ${value.toLocaleString("id-ID")}`;

export default function InventoryPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [notice, setNotice] = useState("Local inventory");

  useEffect(() => {
    let mounted = true;
    void getProducts().then((items) => mounted && setProducts(items.sort((a, b) => a.name.localeCompare(b.name))));
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      mounted = false;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  async function refreshFromSheets() {
    try {
      const fresh = await pullProducts();
      setProducts(fresh);
      setNotice("Loaded from Google Sheets");
    } catch {
      setNotice("Could not reach Google Sheets — showing local inventory");
    }
  }

  function edit(product: Product) {
    setEditingId(product.id);
    setForm({ name: product.name, sku: product.sku, price: String(product.price), stock: String(product.stock), category: product.category || "Coffee" });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const price = Number(form.price);
    const stock = Number(form.stock);
    if (!form.name.trim() || !form.sku.trim() || !Number.isInteger(price) || price < 0 || !Number.isInteger(stock) || stock < 0) {
      setNotice("Enter a name, SKU, whole-number price, and stock quantity");
      return;
    }
    const existing = editingId ? products.find((product) => product.id === editingId) : undefined;
    const product = await saveProduct({ id: editingId ?? identifier(), name: form.name.trim(), sku: form.sku.trim().toUpperCase(), price, stock, category: form.category.trim() || "Other", updatedAt: timestamp() });
    setProducts((current) => [...current.filter((item) => item.id !== product.id), product].sort((a, b) => a.name.localeCompare(b.name)));
    setForm(emptyForm);
    setEditingId(null);
    setNotice(existing ? "Menu item updated locally" : "Menu item added locally");
    if (navigator.onLine) {
      try { await pushPendingOperations(); setNotice("Menu item saved to Google Sheets"); } catch { setNotice("Saved locally — Google Sheets sync will retry"); }
    }
  }

  return <main className="app-shell"><header className="topbar"><div className="brand-lockup"><span className="brand-mark">☕</span><div><strong>Bean Counter</strong><span>Inventory</span></div></div><div className="topbar-actions"><span className={`connection ${online ? "is-online" : "is-offline"}`}><i />{online ? "Online" : "Offline"}</span><button className="secondary-button" onClick={() => void refreshFromSheets()} disabled={!online}>Refresh</button><Link className="secondary-button" href="/">Point of sale</Link></div></header><section className="inventory-page"><div className="page-heading"><div><p className="eyebrow">Menu management</p><h1>Inventory</h1></div><span className="sync-note">{notice}</span></div><div className="inventory-layout"><form className="inventory-form" onSubmit={submit}><h2>{editingId ? "Edit menu item" : "Add menu item"}</h2><label>Item name<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Flat white" /></label><label>SKU<input value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value })} placeholder="COF-001" /></label><div className="form-row"><label>Price (IDR)<input type="number" min="0" step="1" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} placeholder="28000" /></label><label>Stock<input type="number" min="0" step="1" value={form.stock} onChange={(event) => setForm({ ...form, stock: event.target.value })} placeholder="20" /></label></div><label>Category<select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}><option>Coffee</option><option>Tea</option><option>Food</option><option>Other</option></select></label><div className="form-actions"><button className="primary-button" type="submit">{editingId ? "Save changes" : "Add to menu"}</button>{editingId && <button className="secondary-button" type="button" onClick={() => { setEditingId(null); setForm(emptyForm); }}>Cancel</button>}</div><p className="form-note">Changes are stored in this browser first and queued for Google Sheets when online.</p></form><div className="inventory-list"><div className="list-heading"><h2>{products.length} menu items</h2><span>Local catalogue</span></div>{products.length ? products.map((product) => <div className="inventory-row" key={product.id}><span className="product-emoji small">{product.category === "Coffee" ? "☕" : product.category === "Tea" ? "🍵" : "🥐"}</span><div className="inventory-name"><b>{product.name}</b><small>{product.sku} · {product.category}</small></div><span>{money(product.price)}</span><span className={product.stock < 5 ? "low-stock" : "stock-count"}>{product.stock} in stock</span><button className="text-button" onClick={() => edit(product)}>Edit</button></div>) : <div className="empty-state compact"><span>☕</span><p>No menu items yet.</p></div>}</div></div></section></main>;
}
