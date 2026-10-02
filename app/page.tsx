"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getProducts, saveProduct, saveSale } from "@/lib/local-db";
import { pullProducts, pushPendingOperations, syncNow } from "@/lib/client-sync";
import type { Product, SaleItem } from "@/lib/sync-protocol";
import { timestamp } from "@/lib/time";

type CartLine = SaleItem & { stock: number };

const money = (value: number) => `Rp ${value.toLocaleString("id-ID")}`;

export default function Home() {
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState("Loading local catalogue...");

  const categories = useMemo(
    () => ["all", ...new Set(products.map((product) => product.category).filter(Boolean))],
    [products],
  );
  const filteredProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return products.filter((product) => {
      const matchesQuery =
        !normalizedQuery ||
        product.name.toLowerCase().includes(normalizedQuery) ||
        product.sku.toLowerCase().includes(normalizedQuery);
      return matchesQuery && (category === "all" || product.category === category);
    });
  }, [category, products, query]);
  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const itemCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const localProducts = await getProducts();
      if (mounted) {
        setProducts(localProducts.sort((a, b) => a.name.localeCompare(b.name)));
        setBusy(false);
        setNotice(localProducts.length ? "Ready for orders" : "Add products in Inventory to get started");
      }
      if (navigator.onLine) {
        try {
          const freshProducts = await pullProducts();
          if (mounted) {
            setProducts(freshProducts);
            setNotice("Catalogue synced from Google Sheets");
          }
        } catch {
          if (mounted && localProducts.length) setNotice("Offline mode — using local catalogue");
        }
      }
    };
    void load();

    const handleOnline = () => {
      setOnline(true);
      void syncNow().then(({ products: freshProducts }) => {
        if (mounted) {
          setProducts(freshProducts);
          setNotice("Back online — pending changes synced");
        }
      }).catch(() => mounted && setNotice("Back online — tap Sync to retry pending changes"));
    };
    const handleOffline = () => {
      setOnline(false);
      setNotice("Offline mode — sales will sync later");
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      mounted = false;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  function addToCart(product: Product) {
    setCart((current) => {
      const existing = current.find((item) => item.productId === product.id);
      if (existing) {
        if (existing.quantity >= product.stock) return current;
        return current.map((item) =>
          item.productId === product.id ? { ...item, quantity: item.quantity + 1 } : item,
        );
      }
      if (product.stock < 1) return current;
      return [...current, { productId: product.id, name: product.name, quantity: 1, price: product.price, stock: product.stock }];
    });
  }

  function changeQuantity(productId: string, quantity: number) {
    setCart((current) => {
      if (quantity <= 0) return current.filter((item) => item.productId !== productId);
      return current.map((item) => item.productId === productId ? { ...item, quantity: Math.min(quantity, item.stock) } : item);
    });
  }

  async function checkout() {
    if (!cart.length) return;
    setSyncing(true);
    try {
      await saveSale({ items: cart.map(({ productId, name, quantity, price }) => ({ productId, name, quantity, price })), total, paymentMethod: "cash", timestamp: timestamp() });
      const updated = await Promise.all(products.map(async (product) => {
        const line = cart.find((item) => item.productId === product.id);
        return line ? saveProduct({ ...product, stock: product.stock - line.quantity, updatedAt: timestamp() }) : product;
      }));
      setProducts(updated.sort((a, b) => a.name.localeCompare(b.name)));
      setCart([]);
      setNotice(online ? "Sale saved locally — syncing to Google Sheets" : "Sale saved offline — will sync when online");
      if (online) await pushPendingOperations();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save sale");
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
      setNotice(`Synced ${result.pushed} pending change${result.pushed === 1 ? "" : "s"}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  if (busy) return <main className="page-center">Loading POS...</main>;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup"><span className="brand-mark">☕</span><div><strong>Bean Counter</strong><span>Coffee shop POS</span></div></div>
        <div className="topbar-actions">
          <span className={`connection ${online ? "is-online" : "is-offline"}`}><i />{online ? "Online" : "Offline"}</span>
          <button className="secondary-button" onClick={() => void sync()} disabled={!online || syncing}>{syncing ? "Syncing..." : "Sync"}</button>
          <Link className="secondary-button" href="/inventory">Inventory</Link>
        </div>
      </header>

      <div className="workspace">
        <section className="catalogue-panel">
          <div className="page-heading"><div><p className="eyebrow">Today&apos;s counter</p><h1>Take an order</h1></div><span className="sync-note">{notice}</span></div>
          <div className="catalogue-tools"><label className="search-box"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search drinks or SKU" /></label><div className="category-tabs">{categories.map((item) => <button key={item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}>{item === "all" ? "All items" : item}</button>)}</div></div>
          <div className="product-grid">
            {filteredProducts.map((product) => <button className="product-card" key={product.id} onClick={() => addToCart(product)} disabled={product.stock <= 0}><span className="product-emoji">{product.category.toLowerCase().includes("coffee") ? "☕" : product.category.toLowerCase().includes("tea") ? "🍵" : "🥐"}</span><span className="product-card-copy"><b>{product.name}</b><small>{product.sku} · {product.stock} available</small></span><strong>{money(product.price)}</strong></button>)}
          </div>
          {!filteredProducts.length && <div className="empty-state"><span>☕</span><h2>No menu items yet</h2><p>Add your coffee, tea, and food items from Inventory.</p><Link className="primary-button" href="/inventory">Add menu item</Link></div>}
        </section>

        <aside className="cart-panel"><div className="cart-heading"><div><p className="eyebrow">New ticket</p><h2>Current order</h2></div><button className="text-button" onClick={() => setCart([])} disabled={!cart.length}>Clear</button></div><div className="cart-lines">{!cart.length ? <div className="cart-empty"><span>☕</span><p>Your order is empty</p><small>Tap a menu item to add it</small></div> : cart.map((item) => <div className="cart-line" key={item.productId}><div><b>{item.name}</b><small>{money(item.price)} each</small></div><div className="quantity-control"><button onClick={() => changeQuantity(item.productId, item.quantity - 1)}>−</button><span>{item.quantity}</span><button onClick={() => changeQuantity(item.productId, item.quantity + 1)} disabled={item.quantity >= item.stock}>+</button></div><strong>{money(item.price * item.quantity)}</strong></div>)}</div><div className="checkout-box"><div className="summary-row"><span>{itemCount} items</span><span>{money(total)}</span></div><div className="payment-label"><span>Payment</span><b>Cash</b></div><button className="checkout-button" onClick={() => void checkout()} disabled={!cart.length || syncing}>Complete cash sale <span>→</span></button><small className="offline-hint">{online ? "Sale will be written to Google Sheets" : "Offline sale will sync automatically later"}</small></div></aside>
      </div>
    </main>
  );
}
