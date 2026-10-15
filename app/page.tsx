"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TopBar } from "@/components/top-bar";
import { categoryEmoji, matchesQuery, stockStatus } from "@/lib/catalogue";
import { changeDue, formatRupiah, parseAmount, quickCashAmounts } from "@/lib/cash";
import { pullProducts, pushPendingOperations, syncNow } from "@/lib/client-sync";
import { getPendingOperations, getProducts, saveProduct, saveSale } from "@/lib/local-db";
import type { Product, SaleItem } from "@/lib/sync-protocol";
import { timestamp } from "@/lib/time";
import { useOnline } from "@/lib/use-online";

type CartLine = SaleItem & { stock: number };
type Notice = { text: string; tone?: "error" };
type CompletedSale = { total: number; change: number; items: number };

const sortByName = (items: Product[]) => [...items].sort((a, b) => a.name.localeCompare(b.name));

export default function Home() {
  const online = useOnline();
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [tendered, setTendered] = useState("");
  const [completed, setCompleted] = useState<CompletedSale | null>(null);
  const [pending, setPending] = useState(0);
  const [busy, setBusy] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<Notice>({ text: "Loading local catalogue..." });

  const refreshPending = useCallback(async () => {
    setPending((await getPendingOperations()).length);
  }, []);

  const categories = useMemo(
    () => ["all", ...new Set(products.map((product) => product.category).filter(Boolean))],
    [products],
  );
  const filteredProducts = useMemo(
    () => products.filter((product) => matchesQuery(product, query) && (category === "all" || product.category === category)),
    [category, products, query],
  );
  const quantityInCart = useMemo(() => new Map(cart.map((line) => [line.productId, line.quantity])), [cart]);

  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const itemCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const tenderedAmount = parseAmount(tendered);
  const received = tenderedAmount ?? total;
  const shortBy = Math.max(0, total - received);
  const change = changeDue(total, received);
  const filtering = query.trim() !== "" || category !== "all";

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const localProducts = await getProducts();
      if (mounted) {
        setProducts(sortByName(localProducts));
        setBusy(false);
        setNotice({ text: localProducts.length ? "Ready for orders" : "Add products in Inventory to get started" });
      }
      void refreshPending();
      if (navigator.onLine) {
        try {
          const freshProducts = await pullProducts();
          if (mounted) {
            setProducts(freshProducts);
            setNotice({ text: "Catalogue synced from Google Sheets" });
          }
        } catch {
          if (mounted && localProducts.length) setNotice({ text: "Using the catalogue saved on this device" });
        }
      }
    };
    void load();

    const handleOnline = () => {
      void syncNow()
        .then(({ products: freshProducts }) => {
          if (!mounted) return;
          setProducts(freshProducts);
          setNotice({ text: "Back online — pending changes synced" });
          void refreshPending();
        })
        .catch(() => mounted && setNotice({ text: "Back online — tap Sync to retry pending changes", tone: "error" }));
    };
    const handleOffline = () => setNotice({ text: "Offline — sales are saved here and will sync later" });
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      mounted = false;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [refreshPending]);

  function addToCart(product: Product) {
    setCompleted(null);
    setCart((current) => {
      const existing = current.find((item) => item.productId === product.id);
      if (existing) {
        if (existing.quantity >= product.stock) return current;
        return current.map((item) => (item.productId === product.id ? { ...item, quantity: item.quantity + 1 } : item));
      }
      if (product.stock < 1) return current;
      return [...current, { productId: product.id, name: product.name, quantity: 1, price: product.price, stock: product.stock }];
    });
  }

  function changeQuantity(productId: string, quantity: number) {
    setCart((current) => {
      if (quantity <= 0) return current.filter((item) => item.productId !== productId);
      return current.map((item) => (item.productId === productId ? { ...item, quantity: Math.min(quantity, item.stock) } : item));
    });
  }

  function clearOrder() {
    setCart([]);
    setTendered("");
  }

  async function checkout() {
    if (!cart.length || shortBy > 0) return;
    setSyncing(true);
    try {
      await saveSale({
        items: cart.map(({ productId, name, quantity, price }) => ({ productId, name, quantity, price })),
        total,
        paymentMethod: "cash",
        timestamp: timestamp(),
      });
      const updated = await Promise.all(
        products.map(async (product) => {
          const line = cart.find((item) => item.productId === product.id);
          return line ? saveProduct({ ...product, stock: product.stock - line.quantity, updatedAt: timestamp() }) : product;
        }),
      );
      setProducts(sortByName(updated));
      setCompleted({ total, change, items: itemCount });
      clearOrder();
      setNotice({ text: online ? "Sale saved — syncing to Google Sheets" : "Sale saved offline — will sync when online" });
      await refreshPending();
      if (online) {
        await pushPendingOperations();
        setNotice({ text: "Sale synced to Google Sheets" });
        await refreshPending();
      }
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : "Could not complete the sale", tone: "error" });
      await refreshPending();
    } finally {
      setSyncing(false);
    }
  }

  async function sync() {
    if (!online) return;
    setSyncing(true);
    try {
      const result = await syncNow();
      setProducts(result.products);
      setNotice({ text: result.pushed ? `Synced ${result.pushed} pending change${result.pushed === 1 ? "" : "s"}` : "Everything is up to date" });
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : "Sync failed", tone: "error" });
    } finally {
      await refreshPending();
      setSyncing(false);
    }
  }

  if (busy) return <main className="page-center" role="status">Loading POS...</main>;

  return (
    <main className="app-shell">
      <TopBar subtitle="Coffee shop POS" online={online} pending={pending}>
        <button className="secondary-button" onClick={() => void sync()} disabled={!online || syncing}>{syncing ? "Syncing..." : "Sync"}</button>
        <Link className="secondary-button" href="/inventory">Inventory</Link>
      </TopBar>

      <div className="workspace">
        <section className="catalogue-panel" aria-label="Menu">
          <div className="page-heading">
            <div><p className="eyebrow">Today&apos;s counter</p><h1>Take an order</h1></div>
            <span className={`sync-note ${notice.tone === "error" ? "is-error" : ""}`} role="status" aria-live="polite">{notice.text}</span>
          </div>

          <div className="catalogue-tools">
            <label className="search-box">
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search drinks or SKU"
                aria-label="Search drinks or SKU"
              />
            </label>
            <div className="category-tabs" role="group" aria-label="Filter by category">
              {categories.map((item) => (
                <button key={item} className={category === item ? "active" : ""} aria-pressed={category === item} onClick={() => setCategory(item)}>
                  {item === "all" ? "All items" : item}
                </button>
              ))}
            </div>
          </div>

          <div className="product-grid">
            {filteredProducts.map((product) => {
              const status = stockStatus(product.stock);
              const inCart = quantityInCart.get(product.id) ?? 0;
              return (
                <button
                  className={`product-card ${status === "out" ? "is-sold-out" : ""}`}
                  key={product.id}
                  onClick={() => addToCart(product)}
                  disabled={status === "out"}
                  aria-label={`${product.name}, ${formatRupiah(product.price)}, ${status === "out" ? "sold out" : `${product.stock} available`}${inCart ? `, ${inCart} in order` : ""}`}
                >
                  <span className="product-emoji" aria-hidden="true">{categoryEmoji(product.category)}</span>
                  {inCart > 0 && <span className="cart-badge" aria-hidden="true">{inCart}</span>}
                  <span className="product-card-copy">
                    <b>{product.name}</b>
                    <small>{product.sku}</small>
                    {status === "out" && <em className="stock-chip is-out">Sold out</em>}
                    {status === "low" && <em className="stock-chip is-low">Only {product.stock} left</em>}
                  </span>
                  <strong>{formatRupiah(product.price)}</strong>
                </button>
              );
            })}
          </div>

          {!filteredProducts.length && (products.length ? (
            <div className="empty-state">
              <span aria-hidden="true">🔍</span>
              <h2>No matches</h2>
              <p>{filtering ? "Nothing fits that search or category." : "No items to show."}</p>
              <button className="secondary-button" onClick={() => { setQuery(""); setCategory("all"); }}>Clear filters</button>
            </div>
          ) : (
            <div className="empty-state">
              <span aria-hidden="true">☕</span>
              <h2>No menu items yet</h2>
              <p>Add your coffee, tea, and food items from Inventory.</p>
              <Link className="primary-button" href="/inventory">Add menu item</Link>
            </div>
          ))}
        </section>

        <aside className="cart-panel" id="order" aria-label="Current order">
          <div className="cart-heading">
            <div><p className="eyebrow">New ticket</p><h2>Current order</h2></div>
            <button className="text-button" onClick={clearOrder} disabled={!cart.length}>Clear</button>
          </div>

          {completed && (
            <div className="sale-complete" role="status">
              <div>
                <b>Sale complete · {formatRupiah(completed.total)}</b>
                <small>{completed.change > 0 ? `Give ${formatRupiah(completed.change)} change` : "No change due"}</small>
              </div>
              <button className="text-button" onClick={() => setCompleted(null)}>Dismiss</button>
            </div>
          )}

          <div className="cart-lines">
            {!cart.length ? (
              <div className="cart-empty"><span aria-hidden="true">☕</span><p>Your order is empty</p><small>Tap a menu item to add it</small></div>
            ) : (
              cart.map((item) => (
                <div className="cart-line" key={item.productId}>
                  <div><b>{item.name}</b><small>{formatRupiah(item.price)} each</small></div>
                  <div className="quantity-control">
                    <button aria-label={`Remove one ${item.name}`} onClick={() => changeQuantity(item.productId, item.quantity - 1)}>−</button>
                    <span aria-label={`${item.quantity} in order`}>{item.quantity}</span>
                    <button aria-label={`Add one ${item.name}`} onClick={() => changeQuantity(item.productId, item.quantity + 1)} disabled={item.quantity >= item.stock}>+</button>
                  </div>
                  <strong>{formatRupiah(item.price * item.quantity)}</strong>
                </div>
              ))
            )}
          </div>

          <div className="checkout-box">
            <div className="summary-row"><span>{itemCount} {itemCount === 1 ? "item" : "items"}</span><span>{formatRupiah(total)}</span></div>

            <div className="cash-entry">
              <label htmlFor="cash-received">Cash received</label>
              <input
                id="cash-received"
                inputMode="numeric"
                autoComplete="off"
                placeholder={total ? formatRupiah(total) : "Rp 0"}
                value={tenderedAmount === null ? "" : tenderedAmount.toLocaleString("id-ID")}
                onChange={(event) => setTendered(event.target.value)}
                disabled={!cart.length}
              />
              {cart.length > 0 && (
                <div className="quick-cash" role="group" aria-label="Quick cash amounts">
                  {quickCashAmounts(total).map((amount) => (
                    <button key={amount} type="button" onClick={() => setTendered(String(amount))}>{amount === total ? "Exact" : formatRupiah(amount)}</button>
                  ))}
                </div>
              )}
              {cart.length > 0 && (
                <p className={`change-line ${shortBy > 0 ? "is-short" : ""}`} aria-live="polite">
                  {shortBy > 0 ? `Short by ${formatRupiah(shortBy)}` : `Change due ${formatRupiah(change)}`}
                </p>
              )}
            </div>

            <button className="checkout-button" onClick={() => void checkout()} disabled={!cart.length || syncing || shortBy > 0}>
              {syncing ? "Saving..." : "Complete cash sale"} <span aria-hidden="true">→</span>
            </button>
            <small className="offline-hint">{online ? "Sale is saved here first, then written to Google Sheets" : "Offline — the sale will sync automatically later"}</small>
          </div>
        </aside>
      </div>

      {cart.length > 0 && (
        <a className="mobile-cart-bar" href="#order">
          <span>{itemCount} {itemCount === 1 ? "item" : "items"}</span>
          <b>View order · {formatRupiah(total)}</b>
        </a>
      )}
    </main>
  );
}
