"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MenuImport } from "@/components/menu-import";
import { QrisSettings } from "@/components/qris-settings";
import { TopBar } from "@/components/top-bar";
import { categoryEmoji, matchesQuery, stockStatus } from "@/lib/catalogue";
import { formatRupiah } from "@/lib/cash";
import { pullProducts, pushPendingOperations } from "@/lib/client-sync";
import { getPendingOperations, getProducts, saveProduct } from "@/lib/local-db";
import type { Product } from "@/lib/sync-protocol";
import { MADE_TO_ORDER_STOCK } from "@/lib/menu-prep";
import { identifier, timestamp } from "@/lib/time";
import { useOnline } from "@/lib/use-online";

const emptyForm = { name: "", sku: "", price: "", stock: "", category: "Coffee" };
type Notice = { text: string; tone?: "error" };
type FormErrors = Partial<Record<keyof typeof emptyForm, string>>;

const sortByName = (items: Product[]) => [...items].sort((a, b) => a.name.localeCompare(b.name));

function validate(form: typeof emptyForm, products: Product[], editingId: string | null): FormErrors {
  const errors: FormErrors = {};
  const price = Number(form.price);
  const stock = Number(form.stock);
  const sku = form.sku.trim().toUpperCase();

  if (!form.name.trim()) errors.name = "Enter an item name";
  if (!sku) errors.sku = "Enter a SKU";
  else if (products.some((item) => item.sku.toUpperCase() === sku && item.id !== editingId)) errors.sku = "Another item already uses this SKU";
  if (form.price.trim() === "" || !Number.isInteger(price) || price < 0) errors.price = "Whole number, 0 or more";
  if (form.stock.trim() === "" || !Number.isInteger(stock) || stock < 0) errors.stock = "Whole number, 0 or more";
  return errors;
}

export default function InventoryPage() {
  const online = useOnline();
  const [products, setProducts] = useState<Product[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState<FormErrors>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(0);
  const [backingUp, setBackingUp] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>({ text: "Local inventory" });
  const nameInput = useRef<HTMLInputElement>(null);

  const refreshPending = useCallback(async () => {
    setPending((await getPendingOperations()).length);
  }, []);

  useEffect(() => {
    let mounted = true;
    void getProducts().then((items) => mounted && setProducts(sortByName(items)));
    void getPendingOperations().then((operations) => mounted && setPending(operations.length));
    return () => {
      mounted = false;
    };
  }, []);

  const visibleProducts = useMemo(() => products.filter((product) => matchesQuery(product, query)), [products, query]);

  function field(name: keyof typeof emptyForm, value: string) {
    setForm((current) => ({ ...current, [name]: value }));
    if (errors[name]) setErrors((current) => ({ ...current, [name]: undefined }));
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
    setErrors({});
  }

  async function backUpNow() {
    setBackingUp(true);
    setNotice({ text: "Backing up..." });
    try {
      const response = await fetch("/api/backup", { method: "POST" });
      if (response.status === 401) {
        // Full navigation on purpose: the sign-in flow must start from a fresh document.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.href = "/login";
        return;
      }
      const body = (await response.json()) as { error?: string; files?: unknown[]; provider?: string };
      setNotice(
        response.ok
          ? { text: `Backed up ${body.files?.length ?? 0} files to ${body.provider}` }
          : { text: body.error ?? "Backup failed", tone: "error" },
      );
    } catch {
      setNotice({ text: "Backup failed. Check your connection.", tone: "error" });
    } finally {
      setBackingUp(false);
    }
  }

  async function importMenu(items: Array<{ name: string; sku: string; category: string; price: number }>) {
    const added: Product[] = [];
    for (const item of items) {
      added.push(await saveProduct({ id: identifier(), name: item.name, sku: item.sku, price: item.price, stock: MADE_TO_ORDER_STOCK, category: item.category, updatedAt: timestamp() }));
    }
    setProducts((current) => sortByName([...current, ...added]));
    setNotice({ text: `Added ${added.length} menu item${added.length === 1 ? "" : "s"} on this device` });
    await refreshPending();
    if (navigator.onLine) {
      try { await pushPendingOperations(); setNotice({ text: `Added ${added.length} items and saved to Google Sheets` }); } catch { /* queued; sync will retry */ }
      await refreshPending();
    }
  }

  async function refreshFromSheets() {
    try {
      const fresh = await pullProducts();
      setProducts(fresh);
      setNotice({ text: "Loaded from Google Sheets" });
    } catch {
      setNotice({ text: "Could not reach Google Sheets — showing inventory saved on this device", tone: "error" });
    }
  }

  function edit(product: Product) {
    setEditingId(product.id);
    setErrors({});
    setForm({ name: product.name, sku: product.sku, price: String(product.price), stock: String(product.stock), category: product.category || "Coffee" });
    nameInput.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    nameInput.current?.focus({ preventScroll: true });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = validate(form, products, editingId);
    setErrors(found);
    if (Object.keys(found).length) {
      setNotice({ text: "Fix the highlighted fields", tone: "error" });
      return;
    }

    setSaving(true);
    const existing = editingId ? products.find((product) => product.id === editingId) : undefined;
    try {
      const product = await saveProduct({
        id: editingId ?? identifier(),
        name: form.name.trim(),
        sku: form.sku.trim().toUpperCase(),
        price: Number(form.price),
        stock: Number(form.stock),
        category: form.category.trim() || "Other",
        updatedAt: timestamp(),
      });
      setProducts((current) => sortByName([...current.filter((item) => item.id !== product.id), product]));
      resetForm();
      setNotice({ text: existing ? "Menu item updated on this device" : "Menu item added on this device" });
      await refreshPending();
    } catch {
      setNotice({ text: "Could not save this item. Check that the SKU is unique.", tone: "error" });
      setSaving(false);
      return;
    }

    if (navigator.onLine) {
      try {
        await pushPendingOperations();
        setNotice({ text: "Menu item saved to Google Sheets" });
      } catch {
        setNotice({ text: "Saved on this device — Google Sheets sync will retry", tone: "error" });
      }
      await refreshPending();
    }
    setSaving(false);
  }

  return (
    <main className="app-shell">
      <TopBar subtitle="Inventory" online={online} pending={pending}>
        <button className="secondary-button" onClick={() => void refreshFromSheets()} disabled={!online}>Refresh</button>
        <button className="secondary-button" onClick={() => void backUpNow()} disabled={!online || backingUp}>{backingUp ? "Backing up..." : "Back up"}</button>
        <Link className="secondary-button" href="/">Point of sale</Link>
      </TopBar>

      <section className="inventory-page">
        <div className="page-heading">
          <div><p className="eyebrow">Menu management</p><h1>Inventory</h1></div>
          <span className={`sync-note ${notice.tone === "error" ? "is-error" : ""}`} role="status" aria-live="polite">{notice.text}</span>
        </div>

        <div className="inventory-layout">
          <div className="inventory-side">
          <form className="inventory-form" onSubmit={submit} noValidate>
            <h2>{editingId ? "Edit menu item" : "Add menu item"}</h2>

            <label>Item name
              <input ref={nameInput} value={form.name} onChange={(event) => field("name", event.target.value)} placeholder="Flat white" aria-invalid={!!errors.name} aria-describedby={errors.name ? "err-name" : undefined} />
              {errors.name && <span className="field-error" id="err-name" role="alert">{errors.name}</span>}
            </label>

            <label>SKU
              <input value={form.sku} onChange={(event) => field("sku", event.target.value)} placeholder="COF-001" autoCapitalize="characters" aria-invalid={!!errors.sku} aria-describedby={errors.sku ? "err-sku" : undefined} />
              {errors.sku && <span className="field-error" id="err-sku" role="alert">{errors.sku}</span>}
            </label>

            <div className="form-row">
              <label>Price (IDR)
                <input inputMode="numeric" value={form.price} onChange={(event) => field("price", event.target.value)} placeholder="28000" aria-invalid={!!errors.price} aria-describedby={errors.price ? "err-price" : undefined} />
                {errors.price && <span className="field-error" id="err-price" role="alert">{errors.price}</span>}
              </label>
              <label>Stock
                <input inputMode="numeric" value={form.stock} onChange={(event) => field("stock", event.target.value)} placeholder="20" aria-invalid={!!errors.stock} aria-describedby={errors.stock ? "err-stock" : undefined} />
                {errors.stock && <span className="field-error" id="err-stock" role="alert">{errors.stock}</span>}
              </label>
            </div>

            <label>Category
              <select value={form.category} onChange={(event) => field("category", event.target.value)}>
                <option>Coffee</option><option>Non Coffee</option><option>Food</option><option>Extras</option><option>Other</option>
              </select>
            </label>

            <div className="form-actions">
              <button className="primary-button" type="submit" disabled={saving}>{saving ? "Saving..." : editingId ? "Save changes" : "Add to menu"}</button>
              {editingId && <button className="secondary-button" type="button" onClick={resetForm}>Cancel</button>}
            </div>
            <p className="form-note">Changes are saved on this device first and sent to Google Sheets when online.</p>
          </form>
          <MenuImport products={products} onImport={importMenu} />
          <QrisSettings onMessage={(text, error) => setNotice({ text, tone: error ? "error" : undefined })} />
          </div>

          <div className="inventory-list">
            <div className="list-heading">
              <h2>{query ? `${visibleProducts.length} of ${products.length}` : products.length} menu items</h2>
              <label className="inline-search">
                <span className="sr-only">Search inventory</span>
                <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name or SKU" />
              </label>
            </div>

            {visibleProducts.length ? (
              visibleProducts.map((product) => {
                const status = stockStatus(product.stock);
                return (
                  <div className={`inventory-row ${editingId === product.id ? "is-editing" : ""}`} key={product.id}>
                    <span className="product-emoji small" aria-hidden="true">{categoryEmoji(product.category)}</span>
                    <div className="inventory-name"><b>{product.name}</b><small>{product.sku} · {product.category}</small></div>
                    <span>{formatRupiah(product.price)}</span>
                    <span className={status === "ok" ? "stock-count" : "low-stock"}>
                      {status === "out" ? "Sold out" : status === "low" ? `Low · ${product.stock}` : `${product.stock} in stock`}
                    </span>
                    <button className="text-button" onClick={() => edit(product)} aria-label={`Edit ${product.name}`}>Edit</button>
                  </div>
                );
              })
            ) : (
              <div className="empty-state compact">
                <span aria-hidden="true">{products.length ? "🔍" : "☕"}</span>
                <p>{products.length ? "No items match your search." : "No menu items yet. Add your first item on the left."}</p>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
