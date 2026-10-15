# Plan: Best options for QRIS payment confirmation in Bean Counter POS

Date: 2026-10-15 · Repo: `~/coffee-shop-pos` · Current branch: `feature/qris` (manual QRIS, commit `3eb5354`, not yet merged to `main`)

## Goal

Pick and implement the option that gets QRIS payments confirmed automatically in the POS with the least ongoing effort for a single coffee shop, while keeping the manual flow built on `feature/qris` as the fallback.

## Current context / assumptions

- `feature/qris` adds a Cash/QRIS toggle, per-account static QR upload (BRImerchant, GoPay Merchant, BCA, other), optional reference, and stores `paymentMethod`, `paymentProvider`, `paymentRef` on each sale (IndexedDB → Google Sheets `Sales!A:H` → backups). The cashier confirms payment by eye in the merchant app. 35 tests pass.
- The shop already receives money through BRImerchant (static QRIS, ~37 tx/day, Rp 780k/day from the user's screenshot). Settlement goes to a BRI account.
- The POS is Next 16 on Vercel; server routes exist at `app/api/*`; `proxy.ts` enforces session auth except for allow-listed paths (`/api/backup` is one, authenticating itself).
- No bank/provider credentials exist yet. Production Sheets credentials are also still missing (`GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_SHEET_ID`), so Sheets sync fails in prod; that is a separate chore but blocks end-to-end verification of anything that writes to Sheets.
- Facts about providers below come from their public docs as of today; re-check fees and endpoints on the provider's site before onboarding.

## Options compared

| Option | What it is | Onboarding | Fee (MDR) | Auto-confirm | Money lands in | Effort |
| --- | --- | --- | --- | --- | --- | --- |
| **A. Manual (built)** | Show static QR, cashier taps "Payment received" | none | 0–0.7% via existing BRImerchant | no | BRI (existing) | done |
| **B. Reconciliation** | A + daily import of BRImerchant report, flag mismatches | none; owner exports a file | same as A | no, but catches errors next day | BRI | 1 day |
| **C. Aggregator — Midtrans** | Server creates a dynamic QRIS per order (`POST /v2/charge`, `payment_type: "qris"`); customer scans; Midtrans POSTs a signed webhook on `settlement` | self-serve signup with KTP/NIB + bank account; sandbox immediately, live after review (days) | 0.7% regular merchant (BI rate), VAT on fee | **yes**, webhook + status API | Midtrans balance → payout to BRI account (T+1/T+2) | 1–2 days |
| **D. Aggregator — Xendit** | Same idea (`POST /qr_codes`, `type: DYNAMIC`, `api-version: 2022-07-31`), webhook `qr.payment` | self-serve, sandbox with payment simulator | ~0.7% + Rp 4,000 incl. VAT per listing seen (verify) | **yes** | Xendit balance → payout | 1–2 days |
| **E. Bank direct — BRIAPI SNAP** | `qr-mpm-generate-qr` + `qr-mpm-query` + notify callback | partnership agreement with BRI, RSA keys, merchant/terminal IDs; weeks–months, not self-serve | 0.7% (or 0.3%/0% micro) | yes | BRI directly, no payout step | 2–3 days + waiting |
| **F. GoPay Merchant / BCA direct** | Each has partner APIs behind sales processes | same as E, one per provider | same | yes | per provider | multiplied by providers |

### Recommendation

1. **Merge `feature/qris` now (Option A).** It costs nothing, works today, and nothing else is usable without it.
2. **Build Option C (Midtrans) behind a `PAYMENT_PROVIDER=midtrans` flag.** Reasons: self-serve onboarding, a sandbox you can test tonight, one integration covers every QRIS wallet and bank, and the webhook gives true confirmation. At ~Rp 780k/day the 0.7% MDR is about Rp 5.5k/day; the owner should decide if the lost micro-merchant rate on BRImerchant (0%/0.3%) is worth automation. Xendit (D) is equivalent; choose Midtrans unless the owner already has a Xendit account, and keep the provider interface generic so swapping is a one-file change.
3. **Skip E/F unless BRI approaches the shop** or volume grows to the point where the MDR delta matters. The earlier plan (`.hermes/plans/2026-10-15_131046-bri-qris-integration.md`, Phase 3) already specifies the BRIAPI code if that day comes.
4. **Option B (reconciliation) is optional** once C is live, because Midtrans transactions are already listed per order; keep it only if the shop continues to take some payments on the BRImerchant static QR.

The rest of this plan is Option C.

## Architecture / proposed approach

Add a server-side payment-provider module (`lib/payments/`) with a tiny interface (`createQris`, `getStatus`, `verifyWebhook`), a Midtrans implementation, three API routes (`POST /api/payments/qris`, `GET /api/payments/qris/[id]`, `POST /api/payments/midtrans-notify`), and a POS pane that renders the returned QR and polls status until paid, then saves the sale with `paymentProvider: "midtrans"` and `paymentRef = transaction_id`. Payment state lives only in Midtrans; the POS never trusts the browser for "paid" — it asks the server, which asks Midtrans. The manual pane stays as the fallback when the provider is unset or the network is down.

---

## Step-by-step tasks

### Task 0 — Ship the manual flow (owner says "ship it")

```bash
cd ~/coffee-shop-pos && git checkout main && git merge --ff-only feature/qris && git push origin main
```
Expected: `Updating b70f73c..3eb5354` then `Fast-forward`. Vercel auto-deploys; `curl -s -o /dev/null -w "%{http_code}\n" https://coffee-shop-pos-orpin.vercel.app/` → `200` (auth is optional in prod right now).

Owner chores (document, don't automate): add headers `paymentProvider` in `Sales!G1` and `paymentRef` in `Sales!H1`; upload the static QR on each device.

### Task 1 — Provider type and `"midtrans"` as a QRIS provider (TDD)

Branch: `git checkout -b feature/midtrans-qris main`.

**Test first** — append to `lib/sync-protocol.test.ts`:
```ts
it("accepts midtrans as a QRIS provider", () => {
  const items = [{ productId: "p1", name: "Flat white", quantity: 1, price: 28000 }];
  const batch = validateSyncBatch({
    operations: [{ id: "op1", type: "sale.create", payload: { sale: { id: "s1", items, total: 28000, timestamp: 1_700_000_000_000, paymentMethod: "qris", paymentProvider: "midtrans", paymentRef: "1015a919-b03f" } } }],
  });
  expect(batch.operations).toHaveLength(1);
});
```
`npx vitest run lib/sync-protocol.test.ts` → **1 failed** ("QRIS sales need a supported account").

**Implement** — `lib/sync-protocol.ts`: change `export const QRIS_PROVIDERS = ["bri", "gopay", "bca", "other"] as const;` to `["bri", "gopay", "bca", "midtrans", "other"] as const;`. `lib/qris.ts`: add `midtrans: "Midtrans (auto)"` to `QRIS_LABELS` and `midtrans: "Confirmed automatically"` to `QRIS_REF_HINTS`. The Inventory upload card must **not** show a slot for `midtrans`: in `components/qris-settings.tsx` replace `QRIS_PROVIDERS.map(` with `QRIS_PROVIDERS.filter((provider) => provider !== "midtrans").map(`. Same filter in `lib/qris.ts` `providersWithImages` is unnecessary (no image is ever stored for it), but add `midtrans` to `lib/qris.test.ts`'s expectations only if a test breaks.

`npx vitest run` → all pass. Commit `feat(qris): midtrans provider id`.

### Task 2 — Payment provider interface + Midtrans client (TDD on pure parts)

Create `lib/payments/types.ts`:
```ts
export type QrisCharge = {
  /** Provider transaction id; stored as the sale's paymentRef. */
  id: string;
  /** Raw QRIS string to render as a QR image. */
  qrString: string;
  /** Provider-hosted PNG of the QR, if available. */
  qrImageUrl?: string;
  expiresAt: number;
};

export type QrisStatus = "pending" | "paid" | "expired" | "failed";

export interface PaymentProvider {
  id: "midtrans";
  createQris(orderId: string, amountIdr: number): Promise<QrisCharge>;
  getStatus(id: string): Promise<QrisStatus>;
  /** Returns the transaction id and status if the webhook body is authentic, else null. */
  verifyWebhook(body: unknown): { id: string; orderId: string; status: QrisStatus } | null;
}
```

Create `lib/payments/midtrans.ts`:
```ts
import { createHash } from "node:crypto";
import type { PaymentProvider, QrisStatus } from "@/lib/payments/types";

type MidtransCharge = {
  transaction_id: string;
  transaction_status: string;
  qr_string?: string;
  expiry_time?: string;
  actions?: Array<{ name: string; url: string }>;
  status_message?: string;
};

type MidtransNotification = {
  transaction_id: string;
  order_id: string;
  status_code: string;
  gross_amount: string;
  transaction_status: string;
  fraud_status?: string;
  signature_key: string;
};

export function mapStatus(status: string, fraud?: string): QrisStatus {
  if (status === "settlement" || status === "capture") return fraud === "challenge" ? "pending" : "paid";
  if (status === "pending") return "pending";
  if (status === "expire") return "expired";
  return "failed"; // deny, cancel, refund, etc.
}

/** Midtrans signs notifications with sha512(order_id + status_code + gross_amount + server_key). */
export function expectedSignature(serverKey: string, n: Pick<MidtransNotification, "order_id" | "status_code" | "gross_amount">): string {
  return createHash("sha512").update(`${n.order_id}${n.status_code}${n.gross_amount}${serverKey}`).digest("hex");
}

export function midtransProvider(env: { MIDTRANS_SERVER_KEY?: string; MIDTRANS_PRODUCTION?: string; NEXT_PUBLIC_APP_URL?: string }): PaymentProvider {
  const serverKey = env.MIDTRANS_SERVER_KEY;
  if (!serverKey) throw new Error("Missing MIDTRANS_SERVER_KEY");
  const base = env.MIDTRANS_PRODUCTION === "true" ? "https://api.midtrans.com" : "https://api.sandbox.midtrans.com";
  const auth = `Basic ${Buffer.from(`${serverKey}:`).toString("base64")}`;

  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: auth, ...(init?.headers ?? {}) },
      cache: "no-store",
    });
    const json = (await res.json()) as T & { status_message?: string };
    if (!res.ok) throw new Error(`Midtrans ${path} failed: ${json.status_message ?? res.status}`);
    return json;
  }

  return {
    id: "midtrans",
    async createQris(orderId, amountIdr) {
      const notifyUrl = env.NEXT_PUBLIC_APP_URL ? `${env.NEXT_PUBLIC_APP_URL}/api/payments/midtrans-notify` : undefined;
      const charge = await call<MidtransCharge>("/v2/charge", {
        method: "POST",
        headers: notifyUrl ? { "X-Override-Notification": notifyUrl } : {},
        body: JSON.stringify({
          payment_type: "qris",
          transaction_details: { order_id: orderId, gross_amount: amountIdr },
          qris: { acquirer: "gopay" },
          custom_expiry: { expiry_duration: 15, unit: "minute" },
        }),
      });
      if (!charge.qr_string) throw new Error("Midtrans returned no QR string");
      const image = charge.actions?.find((a) => a.name === "generate-qr-code-v2") ?? charge.actions?.find((a) => a.name === "generate-qr-code");
      return {
        id: charge.transaction_id,
        qrString: charge.qr_string,
        qrImageUrl: image?.url,
        expiresAt: charge.expiry_time ? new Date(`${charge.expiry_time.replace(" ", "T")}+07:00`).getTime() : Date.now() + 15 * 60_000,
      };
    },
    async getStatus(id) {
      const status = await call<MidtransCharge & { fraud_status?: string }>(`/v2/${id}/status`);
      return mapStatus(status.transaction_status, status.fraud_status);
    },
    verifyWebhook(body) {
      const n = body as Partial<MidtransNotification>;
      if (!n?.transaction_id || !n.order_id || !n.status_code || !n.gross_amount || !n.signature_key || !n.transaction_status) return null;
      const expected = expectedSignature(serverKey, { order_id: n.order_id, status_code: n.status_code, gross_amount: n.gross_amount });
      if (expected !== n.signature_key) return null;
      return { id: n.transaction_id, orderId: n.order_id, status: mapStatus(n.transaction_status, n.fraud_status) };
    },
  };
}
```

Create `lib/payments/index.ts`:
```ts
import { midtransProvider } from "@/lib/payments/midtrans";
import type { PaymentProvider } from "@/lib/payments/types";

export type ProviderSelection = { ok: true; provider: PaymentProvider } | { ok: false; reason: string };

/** PAYMENT_PROVIDER=midtrans enables automatic QRIS; unset keeps the manual flow only. */
export function selectPaymentProvider(env: Record<string, string | undefined>): ProviderSelection {
  const wanted = env.PAYMENT_PROVIDER?.trim().toLowerCase();
  if (!wanted) return { ok: false, reason: "Automatic QRIS is off. Set PAYMENT_PROVIDER=midtrans." };
  if (wanted !== "midtrans") return { ok: false, reason: `Unknown PAYMENT_PROVIDER "${wanted}".` };
  try {
    return { ok: true, provider: midtransProvider(env) };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Provider misconfigured" };
  }
}
```

**Test** `lib/payments/midtrans.test.ts` (write before the implementation above; run → fail → implement → pass):
```ts
import { describe, expect, it } from "vitest";
import { selectPaymentProvider } from "@/lib/payments";
import { expectedSignature, mapStatus, midtransProvider } from "@/lib/payments/midtrans";

describe("midtrans status mapping", () => {
  it("maps provider statuses", () => {
    expect(mapStatus("settlement", "accept")).toBe("paid");
    expect(mapStatus("capture", "challenge")).toBe("pending");
    expect(mapStatus("pending")).toBe("pending");
    expect(mapStatus("expire")).toBe("expired");
    expect(mapStatus("deny")).toBe("failed");
  });
});

describe("midtrans webhook verification", () => {
  const provider = midtransProvider({ MIDTRANS_SERVER_KEY: "SB-key" });
  const base = { transaction_id: "t1", order_id: "o1", status_code: "200", gross_amount: "28000.00", transaction_status: "settlement", fraud_status: "accept" };

  it("accepts a correctly signed notification", () => {
    const signature_key = expectedSignature("SB-key", base);
    expect(provider.verifyWebhook({ ...base, signature_key })).toEqual({ id: "t1", orderId: "o1", status: "paid" });
  });

  it("rejects a tampered amount", () => {
    const signature_key = expectedSignature("SB-key", base);
    expect(provider.verifyWebhook({ ...base, gross_amount: "1.00", signature_key })).toBeNull();
  });

  it("rejects missing fields", () => {
    expect(provider.verifyWebhook({})).toBeNull();
  });
});

describe("provider selection", () => {
  it("is off when unset", () => expect(selectPaymentProvider({}).ok).toBe(false));
  it("needs the server key", () => {
    expect(selectPaymentProvider({ PAYMENT_PROVIDER: "midtrans" })).toEqual({ ok: false, reason: "Missing MIDTRANS_SERVER_KEY" });
  });
  it("selects midtrans when configured", () => {
    const result = selectPaymentProvider({ PAYMENT_PROVIDER: "midtrans", MIDTRANS_SERVER_KEY: "k" });
    expect(result.ok && result.provider.id).toBe("midtrans");
  });
});
```
`npx vitest run lib/payments` → 7 passed. Commit `feat(payments): midtrans provider`.

### Task 3 — API routes

`app/api/payments/qris/route.ts`:
```ts
import { NextResponse } from "next/server";
import { selectPaymentProvider } from "@/lib/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const selection = selectPaymentProvider(process.env);
  return NextResponse.json(selection.ok ? { enabled: true, provider: selection.provider.id } : { enabled: false, reason: selection.reason });
}

export async function POST(request: Request) {
  const selection = selectPaymentProvider(process.env);
  if (!selection.ok) return NextResponse.json({ error: selection.reason }, { status: 503 });

  const body = (await request.json().catch(() => null)) as { orderId?: string; total?: number } | null;
  if (!body?.orderId || !Number.isInteger(body.total) || (body.total ?? 0) <= 0) {
    return NextResponse.json({ error: "orderId and a positive integer total are required" }, { status: 400 });
  }
  try {
    return NextResponse.json(await selection.provider.createQris(body.orderId, body.total!));
  } catch (error) {
    console.error("QRIS create failed", error);
    return NextResponse.json({ error: "Could not create a QRIS code. Use the manual QR instead." }, { status: 502 });
  }
}
```

`app/api/payments/qris/[id]/route.ts`:
```ts
import { NextResponse } from "next/server";
import { selectPaymentProvider } from "@/lib/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const selection = selectPaymentProvider(process.env);
  if (!selection.ok) return NextResponse.json({ error: selection.reason }, { status: 503 });
  const { id } = await context.params;
  if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  try {
    return NextResponse.json({ status: await selection.provider.getStatus(id) });
  } catch (error) {
    console.error("QRIS status failed", error);
    return NextResponse.json({ error: "Status check failed" }, { status: 502 });
  }
}
```

`app/api/payments/midtrans-notify/route.ts` (public, signature-verified; it only acknowledges — the POS polls status, so no server-side state is needed in v1):
```ts
import { NextResponse } from "next/server";
import { selectPaymentProvider } from "@/lib/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const selection = selectPaymentProvider(process.env);
  if (!selection.ok) return NextResponse.json({ ok: false }, { status: 503 });
  const verified = selection.provider.verifyWebhook(await request.json().catch(() => null));
  if (!verified) return NextResponse.json({ ok: false }, { status: 401 });
  console.info("Midtrans notification", verified);
  return NextResponse.json({ ok: true });
}
```

`proxy.ts`: change
```ts
  if (pathname === "/api/backup") return NextResponse.next();
```
to
```ts
  if (pathname === "/api/backup" || pathname === "/api/payments/midtrans-notify") return NextResponse.next();
```
(`/api/payments/qris*` stays behind the session rule when sign-in is required; with `AUTH_REQUIRED=false` everything is open anyway.)

Verify: `npx tsc --noEmit && npm run build` → route list includes `ƒ /api/payments/qris`, `ƒ /api/payments/qris/[id]`, `ƒ /api/payments/midtrans-notify`. Local smoke without keys: `npx next start -p 3997 &; curl -s localhost:3997/api/payments/qris` → `{"enabled":false,"reason":"Automatic QRIS is off. Set PAYMENT_PROVIDER=midtrans."}`. Commit `feat(payments): qris api routes`.

### Task 4 — Render the QR in the POS and poll until paid

`npm i qrcode && npm i -D @types/qrcode`.

Create `components/qris-auto.tsx`:
```tsx
"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { formatRupiah } from "@/lib/cash";

type Charge = { id: string; qrString: string; expiresAt: number };
type Props = { orderId: string; total: number; onPaid: (transactionId: string) => void; onFallback: (reason: string) => void };

/** Creates a per-order QRIS via the server, shows it, and polls status every 3 s until paid/expired. */
export function QrisAuto({ orderId, total, onPaid, onFallback }: Props) {
  const [charge, setCharge] = useState<Charge | null>(null);
  const [image, setImage] = useState<string>("");
  const [state, setState] = useState<"creating" | "waiting" | "paid" | "expired">("creating");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/payments/qris", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId, total }) });
      const body = (await res.json()) as Charge & { error?: string };
      if (cancelled) return;
      if (!res.ok) return onFallback(body.error ?? "Automatic QRIS unavailable");
      setCharge(body);
      setImage(await QRCode.toDataURL(body.qrString, { margin: 1, width: 280 }));
      setState("waiting");
    })().catch(() => !cancelled && onFallback("Automatic QRIS unavailable"));
    return () => { cancelled = true; };
  }, [orderId, total, onFallback]);

  useEffect(() => {
    if (!charge || state !== "waiting") return;
    const timer = setInterval(async () => {
      if (Date.now() > charge.expiresAt) { setState("expired"); clearInterval(timer); return; }
      const res = await fetch(`/api/payments/qris/${charge.id}`, { cache: "no-store" });
      const body = (await res.json()) as { status?: string };
      if (body.status === "paid") { setState("paid"); clearInterval(timer); onPaid(charge.id); }
      if (body.status === "expired" || body.status === "failed") { setState("expired"); clearInterval(timer); }
    }, 3000);
    return () => clearInterval(timer);
  }, [charge, state, onPaid]);

  if (state === "creating") return <p className="qris-amount">Creating QR…</p>;
  if (state === "expired") return <p className="change-line is-short">QR expired. Switch to Cash or re-open QRIS to try again.</p>;
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image} alt="Scan to pay with QRIS" className="qris-checkout" />
      <p className="qris-amount">Customer pays <b>{formatRupiah(total)}</b></p>
      <p className="qris-waiting" aria-live="polite">{state === "paid" ? "Payment received" : "Waiting for payment…"}</p>
    </>
  );
}
```

`app/page.tsx` changes:
1. State: `const [autoQris, setAutoQris] = useState(false); const [orderId, setOrderId] = useState("");` and in the load effect: `fetch("/api/payments/qris").then((r) => r.json()).then((b: { enabled?: boolean }) => mounted && setAutoQris(Boolean(b.enabled))).catch(() => {});`
2. When the cashier switches to QRIS with auto enabled, mint an order id once: in the toggle's `onClick`, `() => { setMethod("qris"); if (autoQris && !orderId) setOrderId(`bc-${identifier()}`); }` (import `identifier` from `@/lib/time`). Reset `setOrderId("")` inside `clearOrder()`.
3. Extract the body of `checkout()` into `async function completeSale(paidByQris: boolean, ref: string | undefined, qrisProvider: QrisProvider)` and make the existing `checkout()` call `completeSale(method === "qris", cleanReference(paymentRef), provider)`. Add:
```tsx
const handleAutoPaid = useCallback((transactionId: string) => { void completeSale(true, transactionId, "midtrans"); }, [completeSale]);
const handleFallback = useCallback((reason: string) => { setNotice({ text: `${reason} — showing the saved QR`, tone: "error" }); setAutoQris(false); }, []);
```
(`completeSale` must therefore be a `useCallback` too, or inline `handleAutoPaid` without memo and accept the lint warning — prefer `useCallback`.)
4. In the QRIS pane, before the manual branch:
```tsx
{autoQris && cart.length > 0 ? (
  <QrisAuto orderId={orderId} total={total} onPaid={handleAutoPaid} onFallback={handleFallback} />
) : ( /* existing manual pane unchanged */ )}
```
5. Hide the "Payment received" button when `autoQris && method === "qris"` (payment completes itself); show it only in manual mode.

CSS `app/globals.css`: `.qris-waiting { color: var(--sage); font-size: 14px; font-weight: 700; margin: 8px 0 0; }`.

Verify: `npx eslint && npx tsc --noEmit && npx vitest run` clean. Commit `feat(pos): automatic QRIS via provider`.

### Task 5 — Sandbox end-to-end

Owner creates a Midtrans account (dashboard.sandbox.midtrans.com), copies the **sandbox Server Key**. Store it with `vercel env add MIDTRANS_SERVER_KEY preview` (and `PAYMENT_PROVIDER=midtrans`, `MIDTRANS_PRODUCTION=false`) — never paste the key in chat. Locally: put the same in `.env.local` (gitignored).

Smoke script `scripts/midtrans-smoke.mjs`:
```js
// Usage: MIDTRANS_SERVER_KEY=... node scripts/midtrans-smoke.mjs
const auth = "Basic " + Buffer.from(process.env.MIDTRANS_SERVER_KEY + ":").toString("base64");
const res = await fetch("https://api.sandbox.midtrans.com/v2/charge", {
  method: "POST",
  headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: auth },
  body: JSON.stringify({ payment_type: "qris", transaction_details: { order_id: "smoke-" + Date.now(), gross_amount: 10000 }, qris: { acquirer: "gopay" } }),
});
const json = await res.json();
console.log(res.status, json.transaction_status, json.transaction_id, (json.qr_string ?? "").slice(0, 20));
```
Expected: `201 pending <uuid> 00020101021226620014`. Then pay it with the Midtrans sandbox simulator (dashboard → Transactions → simulate, or the GoPay simulator URL shown in the docs), and `curl -u "$MIDTRANS_SERVER_KEY:" https://api.sandbox.midtrans.com/v2/<transaction_id>/status` → `"transaction_status":"settlement"`.

Full flow: `npx next dev`, Inventory → add an item, POS → QRIS → QR appears → simulate payment → within 3 s the banner reads "Sale complete · Paid by QRIS · Midtrans (auto) · ref <id>" and the sale is stored with `paymentProvider: "midtrans"` (check with the IndexedDB snippet used in earlier testing).

Webhook: set the dashboard's Payment Notification URL to `https://<preview-url>/api/payments/midtrans-notify`; the dashboard's "test notification" must return 200. (It only logs in v1; polling is the source of truth.)

### Task 6 — Docs, preview, ship

README `## QRIS payments`: add a subsection "Automatic confirmation (Midtrans)" listing the three env vars, the notification URL, and the fee note; state that the manual pane remains the fallback. Push `feature/midtrans-qris`, confirm the Vercel preview builds, then on the owner's "ship it": `git checkout main && git merge --ff-only feature/midtrans-qris && git push origin main`, add the **production** server key (`MIDTRANS_PRODUCTION=true`) only after Midtrans approves the live account.

---

## Tests / validation summary

- Unit: `lib/sync-protocol.test.ts` (+1), `lib/payments/midtrans.test.ts` (7), existing 35 → 43 passing via `npx vitest run`.
- Static: `npx eslint && npx tsc --noEmit && npm run build` clean after every task.
- Integration: Task 5 smoke script and the browser flow in sandbox; expected outputs stated inline.
- Regression: cash sale and manual QRIS sale still work with `PAYMENT_PROVIDER` unset (`GET /api/payments/qris` → `enabled:false`, POS shows the saved QR pane).

## Risks, tradeoffs, open questions

- **Fees:** Midtrans charges the regular 0.7% MDR; BRImerchant may currently give the shop the micro-merchant 0% (≤ Rp 500k) rate. At today's volume that is roughly Rp 5–6k/day. The owner must decide whether automatic confirmation is worth it — ask before Task 5.
- **Settlement path changes:** money goes to the Midtrans balance, then paid out to the BRI account (typically next business day), instead of landing in BRI directly. Daily cash-flow reporting in BRImerchant will no longer show these sales.
- **Offline:** dynamic QR needs the network at the moment of sale. The manual pane covers outages; the POS falls back automatically when the create call fails.
- **Expiry:** 15 minutes per QR; a slow customer needs a fresh one. The pane shows "QR expired" and the cashier re-opens QRIS.
- **Webhook idempotency and race:** v1 relies on polling; the webhook is only verified and logged. If the owner later wants server-side records (e.g. to reconcile without the POS being open), add a `Payments` Sheets tab written from the webhook — out of scope now (YAGNI).
- **Acquirer:** `qris: { acquirer: "gopay" }` is Midtrans's default and works for any QRIS wallet/bank on the customer side; the acquirer only decides who settles. Confirm in the dashboard that QRIS is enabled for the account.
- **Open questions for the owner:** (1) Midtrans or Xendit — any existing account? (2) Accept 0.7% MDR for automation? (3) Keep the BRImerchant static QR as a second option at the counter, or go all-in on the aggregator? (4) Business documents ready for aggregator KYC (KTP, NPWP/NIB, bank account)?
