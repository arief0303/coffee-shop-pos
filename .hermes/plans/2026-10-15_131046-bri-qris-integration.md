# Plan: Integrate Bean Counter POS with BRI (QRIS via BRImerchant)

Date: 2026-10-15 · Repo: `~/coffee-shop-pos` (Next 16, Vercel prod `https://coffee-shop-pos-orpin.vercel.app`) · Branch to use: `feature/bri-qris`

## Goal

Let the cashier take QRIS payments through the shop's existing BRI merchant account in the POS, record them next to cash sales, and reconcile them against BRImerchant's own transaction list — without waiting on a bank API approval to ship something useful.

## Current context / assumptions

- The shop already accepts QRIS through **BRImerchant** (screenshot: MPAN `9360000200431 83…`, outlet "PREP. COFFEE", 37 transactions / Rp 783.000 today, payments arriving as "QRIS - BCA" etc. with a BRI `No. Ref`). That means a **static QRIS** sticker/standee already exists and works. Settlement from BRI is H+1 (06:30–10:00 WIB), cut-off 23:30 WIB.
- The POS currently only knows `paymentMethod: "cash"`. The type, the validator in `lib/sync-protocol.ts` (`assertSale` throws "Only cash payments are supported"), the Sheets writer in `lib/google-sheets.ts`, the Sheets reader (`readSalesFromSheets` hard-codes `"cash"`), the backup CSV, and the checkout UI in `app/page.tsx` all assume cash.
- Sales are stored offline-first in IndexedDB (`lib/local-db.ts`) and pushed to a Google Sheet (`Sales!A:F` → id, items JSON, total, timestamp, paymentMethod, id). Production currently lacks the Sheets service-account variables, so sync fails there; that is independent of this plan but blocks Phase 2 end-to-end testing in prod.
- BRI's developer API (**BRIAPI**, SNAP-BI standard) offers *QRIS MPM Dynamic*: `POST /v1.1/qr-dynamic-mpm/qr-mpm-generate-qr` (amount in, `qrContent` string out), `POST /v1.1/qr-dynamic-mpm/qr-mpm-query` (status: `00` success … `07` not found), plus an optional payment-notify webhook BRI calls on the partner's URL. Auth is OAuth B2B: `POST /snap/v1.0/access-token/b2b` with `X-SIGNATURE = SHA256withRSA(privateKey, clientId + "|" + X-TIMESTAMP)`, then per-request `X-SIGNATURE = HMAC-SHA512(clientSecret, METHOD:PATH:token:lowercase(hex(sha256(minified body))):timestamp)`. Sandbox `https://sandbox.partner.api.bri.co.id/`, production `https://partner.api.bri.co.id/`. Production access requires a partner agreement with BRI and a `merchantId`/`terminalId` issued by BRI — **not something the dev can self-serve**. Facts above come from developers.bri.co.id; re-verify field names against the live docs before coding Phase 3.
- There is **no public API for the BRImerchant consumer app** itself (no CSV export API, no push notifications to third parties). The app can download settlement reports per MID (daily, up to 1 month) as files.

## Architecture / proposed approach

Ship in three independent phases, each useful on its own:

1. **Phase 1 — QRIS as a payment method (no bank API).** The POS gets a Cash / QRIS toggle. QRIS checkout shows the shop's static QR (uploaded once in Inventory settings), the amount to pay, and a "Paid — confirm" button where the cashier types the last digits of BRI's `No. Ref` from the BRImerchant notification. The sale is saved with `paymentMethod: "qris"` and `paymentRef`. Everything else (offline queue, Sheets, backups) carries the new fields.
2. **Phase 2 — Reconciliation against BRImerchant's report.** Inventory gets an "Import BRI report" screen that accepts the file BRImerchant exports, matches rows to QRIS sales by amount + time window (± 10 min) + ref suffix, and flags unmatched sales on both sides. Output: a Sheets tab `Reconciliation` and an on-screen summary.
3. **Phase 3 (gated) — Dynamic QRIS via BRIAPI.** Only if BRI grants production partner access. Server route generates a per-order QR with the amount embedded, POS polls status every 3 s, and marks the sale paid automatically. Built behind `PAYMENT_PROVIDER=bri-snap`; the Phase 1 manual flow stays as the fallback.

Phases 1 and 2 are the recommended immediate work. Phase 3 is specified so the implementer can start a sandbox spike while BRI onboarding is in progress.

---

## Phase 1 — QRIS payment method (manual confirmation)

### Task 1.1 — Extend the sale type and validator (TDD)

**Test first.** Append to `lib/sync-protocol.test.ts`:

```ts
describe("payment methods", () => {
  const items = [{ productId: "p1", name: "Flat white", quantity: 1, price: 28000 }];
  const base = { id: "s-qris", items, total: 28000, timestamp: 1_700_000_000_000 };

  it("accepts a qris sale with a reference", () => {
    const batch = validateSyncBatch({
      operations: [{ id: "op1", type: "sale.create", payload: { sale: { ...base, paymentMethod: "qris", paymentRef: "033265" } } }],
    });
    expect(batch.operations).toHaveLength(1);
  });

  it("rejects unknown payment methods", () => {
    expect(() =>
      validateSyncBatch({
        operations: [{ id: "op1", type: "sale.create", payload: { sale: { ...base, paymentMethod: "card" } } }],
      }),
    ).toThrow("Unsupported payment method");
  });

  it("requires a reference for qris sales", () => {
    expect(() =>
      validateSyncBatch({
        operations: [{ id: "op1", type: "sale.create", payload: { sale: { ...base, paymentMethod: "qris" } } }],
      }),
    ).toThrow("QRIS sales need a payment reference");
  });
});
```

Run: `npx vitest run lib/sync-protocol.test.ts` → expect **3 failed** (type error on `"qris"` plus the two throw messages).

**Implement** in `lib/sync-protocol.ts`:

```ts
export const PAYMENT_METHODS = ["cash", "qris"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export type Sale = {
  id: string;
  items: SaleItem[];
  total: number;
  paymentMethod: PaymentMethod;
  /** BRI "No. Ref" (or its last 6 digits) typed by the cashier for QRIS sales. */
  paymentRef?: string;
  timestamp: number;
};
```

Replace the line `if (sale.paymentMethod !== "cash") throw new Error("Only cash payments are supported");` with:

```ts
  if (!PAYMENT_METHODS.includes(sale.paymentMethod as PaymentMethod)) {
    throw new Error("Unsupported payment method");
  }
  if (sale.paymentMethod === "qris" && !isNonEmptyString(sale.paymentRef)) {
    throw new Error("QRIS sales need a payment reference");
  }
  if (sale.paymentRef !== undefined && (typeof sale.paymentRef !== "string" || sale.paymentRef.length > 64)) {
    throw new Error("Payment reference is invalid");
  }
```

Run: `npx vitest run lib/sync-protocol.test.ts` → **all pass**. Then `npx tsc --noEmit` → it will now fail in `lib/google-sheets.ts` (`"cash" as const`) and the backup CSV; that is expected and fixed in 1.2.

Commit: `git commit -am "feat(sales): qris payment method with reference"`.

### Task 1.2 — Persist the new fields in Sheets and backups

`lib/google-sheets.ts`:

- Change `const SALES_RANGE = "Sales!A:F";` to `"Sales!A:G"`.
- In `appendSaleIfMissing`, replace the trailing `sale.id,` (column F, a duplicate) with:
  ```ts
        sale.paymentRef ?? "",
        sale.id,
  ```
  Final column order: id, items, total, timestamp, paymentMethod, paymentRef, id. (Column G keeps the old duplicate id so nothing that reads column F by position breaks the old rows; new rows have ref in F.) **Note for implementer:** old rows have the id in F. The reader below treats a value in F that equals A as "no ref".
- In `readSalesFromSheets`, replace `paymentMethod: "cash" as const,` with:
  ```ts
        paymentMethod: (row[4] === "qris" ? "qris" : "cash") as Sale["paymentMethod"],
        paymentRef: row[5] && row[5] !== row[0] ? row[5] : undefined,
  ```

`lib/backup/snapshot.ts`, sales CSV: change the header to `["id", "timestamp", "paymentMethod", "paymentRef", "total", "items"]` and the row to `[s.id, new Date(s.timestamp).toISOString(), s.paymentMethod, s.paymentRef ?? "", s.total, JSON.stringify(s.items)]`. Update the assertion in `lib/backup/backup.test.ts` (`files[2].body.split("\n")[0]`) to the new header string.

Run: `npx tsc --noEmit && npx vitest run` → clean, all pass. Commit: `feat(sheets): store payment reference`.

Manual Sheet step for the owner (document in README): add header `paymentRef` in `Sales!F1` and move the existing header of F to G. No data migration needed.

### Task 1.3 — Store the static QR image locally

The QR must work offline, so store it in IndexedDB, not in env vars.

`lib/local-db.ts`:

- Add to `PosDatabase`: `settings: { key: string; value: { key: string; value: string } };`
- Bump `openDB<PosDatabase>("pos-system", 1, …)` to version **2** and inside `upgrade(database, oldVersion)` add:
  ```ts
        if (oldVersion < 2) database.createObjectStore("settings", { keyPath: "key" });
  ```
  Keep the version-1 store creation guarded with `if (oldVersion < 1) { …existing code… }`.
- Add:
  ```ts
  export async function getSetting(key: string): Promise<string | undefined> {
    return (await (await getDatabase()).get("settings", key))?.value;
  }
  export async function setSetting(key: string, value: string): Promise<void> {
    await (await getDatabase()).put("settings", { key, value });
  }
  export const QRIS_IMAGE_SETTING = "qris-image-data-url";
  ```

Test (new `lib/local-db.test.ts` needs `fake-indexeddb`): `npm i -D fake-indexeddb`, then:

```ts
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { getSetting, setSetting } from "@/lib/local-db";

describe("settings store", () => {
  it("round-trips a value", async () => {
    await setSetting("k", "v");
    expect(await getSetting("k")).toBe("v");
    expect(await getSetting("missing")).toBeUndefined();
  });
});
```

Run `npx vitest run lib/local-db.test.ts` → pass. Commit: `feat(db): settings store for static QRIS image`.

### Task 1.4 — Upload the QR in Inventory

In `app/inventory/page.tsx`, below the add-item form inside `<form className="inventory-form">`'s parent column, add a second card:

```tsx
<section className="inventory-form" aria-labelledby="qris-heading">
  <h2 id="qris-heading">QRIS sticker</h2>
  <p className="form-note">Upload a photo or PNG of the shop&apos;s static QRIS from BRImerchant (QRIS Statis). It is kept on this device and shown at checkout.</p>
  {qrisImage ? <img src={qrisImage} alt="Shop QRIS code" className="qris-preview" /> : <p className="form-note">No QRIS uploaded yet.</p>}
  <label>Choose image
    <input type="file" accept="image/*" onChange={(event) => void uploadQris(event.target.files?.[0])} />
  </label>
</section>
```

State and handler (place next to the other `useState` hooks / functions):

```tsx
const [qrisImage, setQrisImage] = useState<string | undefined>();

useEffect(() => { void getSetting(QRIS_IMAGE_SETTING).then(setQrisImage); }, []);

async function uploadQris(file: File | undefined) {
  if (!file) return;
  if (file.size > 1_500_000) { setNotice({ text: "Image is too large (max 1.5 MB)", tone: "error" }); return; }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  await setSetting(QRIS_IMAGE_SETTING, dataUrl);
  setQrisImage(dataUrl);
  setNotice({ text: "QRIS saved on this device" });
}
```

Import `getSetting, setSetting, QRIS_IMAGE_SETTING` from `@/lib/local-db`. CSS in `app/globals.css`: `.qris-preview { border: 1px solid var(--line); border-radius: 10px; display: block; margin: 10px 0; max-width: 220px; width: 100%; }`.

ESLint will flag `<img>`; add `// eslint-disable-next-line @next/next/no-img-element` above it (data URLs can't use `next/image`).

Verify: `npm run build` clean; in a browser, upload any PNG on `/inventory`, reload, the preview persists.

Commit: `feat(inventory): upload static QRIS image`.

### Task 1.5 — Checkout: Cash / QRIS toggle and confirmation

`app/page.tsx` changes:

1. State: `const [method, setMethod] = useState<PaymentMethod>("cash"); const [paymentRef, setPaymentRef] = useState(""); const [qrisImage, setQrisImage] = useState<string | undefined>();` and load the image in the existing load effect: `setQrisImage(await getSetting(QRIS_IMAGE_SETTING));`.
2. Replace the `<div className="cash-entry">…</div>` block with:

```tsx
<div className="method-toggle" role="group" aria-label="Payment method">
  <button type="button" className={method === "cash" ? "active" : ""} aria-pressed={method === "cash"} onClick={() => setMethod("cash")}>Cash</button>
  <button type="button" className={method === "qris" ? "active" : ""} aria-pressed={method === "qris"} onClick={() => setMethod("qris")}>QRIS</button>
</div>

{method === "cash" ? (
  <div className="cash-entry">{/* existing cash input, quick-cash, change-line unchanged */}</div>
) : (
  <div className="qris-entry">
    {qrisImage ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={qrisImage} alt="Scan to pay with QRIS" className="qris-checkout" />
    ) : (
      <p className="change-line is-short">Upload the shop QRIS in Inventory first.</p>
    )}
    <p className="qris-amount">Customer pays <b>{formatRupiah(total)}</b></p>
    <label htmlFor="payment-ref">BRI No. Ref (last 6 digits)</label>
    <input id="payment-ref" inputMode="numeric" maxLength={12} autoComplete="off" value={paymentRef}
      onChange={(event) => setPaymentRef(event.target.value.replace(/\D/g, ""))} placeholder="e.g. 033265" disabled={!cart.length} />
    <small className="offline-hint">Check the BRImerchant notification shows {formatRupiah(total)}, then enter its reference.</small>
  </div>
)}
```

3. Checkout button: label `method === "qris" ? "Confirm QRIS payment" : "Complete cash sale"`; disabled when `!cart.length || syncing || (method === "cash" && shortBy > 0) || (method === "qris" && (paymentRef.length < 6 || !qrisImage))`.
4. In `checkout()`: `paymentMethod: method, paymentRef: method === "qris" ? paymentRef : undefined,` in `saveSale`; the completed banner for QRIS: `{ total, change: 0, items: itemCount }`; after a sale call `setPaymentRef("")` inside `clearOrder()`.
5. The "sale complete" banner: when `completed.change === 0 && method === "qris"` show `Paid by QRIS · ref {ref}` — store `ref` in `CompletedSale` as optional.

CSS (`app/globals.css`):

```css
.method-toggle { display: grid; gap: 6px; grid-template-columns: 1fr 1fr; margin-top: 17px; }
.method-toggle button { background: var(--paper); border: 1px solid var(--line); border-radius: 8px; font-weight: 700; min-height: 44px; }
.method-toggle button.active { background: var(--espresso); border-color: var(--espresso); color: #fffaf3; }
.qris-entry { border-top: 1px solid #e7dbcd; margin-top: 14px; padding-top: 14px; text-align: center; }
.qris-checkout { border-radius: 10px; margin: 0 auto 10px; max-width: 220px; width: 100%; }
.qris-amount { font-size: 15px; margin: 0 0 10px; }
.qris-entry label { color: var(--muted); display: block; font-size: 12px; margin-bottom: 6px; text-align: left; }
.qris-entry input { background: #fffaf4; border: 1px solid var(--line); border-radius: 8px; font-size: 18px; font-weight: 700; letter-spacing: .08em; min-height: 46px; padding: 0 12px; text-align: center; width: 100%; }
```

Verify (local): `AUTH_REQUIRED=false AUTH_SECRET=x npx next start -p 3995`; in a browser add an item, switch to QRIS → button disabled until 6 digits typed; confirm → banner shows "Paid by QRIS · ref 033265"; "1 unsynced" chip appears (no Sheets locally). `npx eslint && npx tsc --noEmit && npx vitest run` clean.

Commit: `feat(pos): QRIS checkout with manual confirmation`.

### Task 1.6 — README + ship

README: under a new `## Payments` heading, 5 lines: cash vs QRIS, where to upload the sticker, what the cashier types, where it lands in the Sheet (`paymentMethod`, `paymentRef`), and the one-time `Sales!F1` header change.

Push `feature/bri-qris`, check the Vercel preview builds, then merge to `main` (fast-forward) after the user says ship.

---

## Phase 2 — Reconcile against BRImerchant's report

### Task 2.1 — Confirm the report format (owner action, blocks the rest)

Ask the owner to export one day's report from BRImerchant (**Laporan → download per MID**) and share the file (XLSX/CSV/PDF) in chat or drop it in `~/coffee-shop-pos/fixtures/bri-report-sample.*` (gitignore real data; commit a scrubbed copy with fake refs). The parser in 2.2 is written against that sample. Until then, write the matcher only (2.3) which is format-independent.

### Task 2.2 — Parser `lib/reconcile/bri-report.ts`

Target shape:

```ts
export type BriRow = { ref: string; amount: number; paidAt: number; channel: string; raw: string[] };
export function parseBriReport(text: string): BriRow[];
```

If the export is XLSX, add `npm i xlsx` (SheetJS) and parse the first sheet to rows of strings first, then map. Column names are unknown until 2.1 — the implementer must map by header text found in the sample, not by position. Write `lib/reconcile/bri-report.test.ts` against the scrubbed fixture: `expect(parseBriReport(fixture)).toHaveLength(N)` and spot-check one ref/amount.

### Task 2.3 — Matcher `lib/reconcile/match.ts` (TDD)

```ts
import type { Sale } from "@/lib/sync-protocol";
import type { BriRow } from "@/lib/reconcile/bri-report";

export type MatchResult = {
  matched: Array<{ sale: Sale; row: BriRow }>;
  unmatchedSales: Sale[];   // QRIS sales in POS with no BRI row
  unmatchedRows: BriRow[];  // BRI payments with no POS sale (likely forgotten in POS)
};

const WINDOW_MS = 10 * 60 * 1000;

export function matchSales(sales: Sale[], rows: BriRow[]): MatchResult {
  const remaining = new Set(rows);
  const matched: MatchResult["matched"] = [];
  const unmatchedSales: Sale[] = [];

  for (const sale of sales.filter((s) => s.paymentMethod === "qris")) {
    const candidates = [...remaining].filter((r) => r.amount === sale.total && Math.abs(r.paidAt - sale.timestamp) <= WINDOW_MS);
    const byRef = candidates.find((r) => sale.paymentRef && r.ref.endsWith(sale.paymentRef));
    const pick = byRef ?? (candidates.length === 1 ? candidates[0] : undefined);
    if (pick) { matched.push({ sale, row: pick }); remaining.delete(pick); } else unmatchedSales.push(sale);
  }
  return { matched, unmatchedSales, unmatchedRows: [...remaining] };
}
```

Tests (`lib/reconcile/match.test.ts`): exact ref match wins over amount-only; amount+time with a single candidate matches; two candidates with no ref → unmatched (never guess); cash sales are ignored; BRI rows with no sale land in `unmatchedRows`. Run → fail → implement → pass. Commit.

### Task 2.4 — Import UI + Sheets output

- `app/api/reconcile/route.ts` (`POST`, auth like `/api/backup`: session or `CRON_SECRET`): body `{ report: string }`; reads sales via `readSalesFromSheets()`, runs parser + matcher, appends rows to a `Reconciliation!A:F` tab (date, saleId, briRef, amount, status ∈ matched|missing-in-bri|missing-in-pos, note) using the same `getSheetsClient()` helper, returns the summary counts.
- Inventory page: new card "Reconcile BRI" with a file input; read file as text (or ArrayBuffer→base64 if XLSX) and POST; show `Matched 31 · Missing in BRI 2 · Missing in POS 4`.

Verify with the fixture end-to-end in sandbox Sheets (requires the Sheets env vars — currently absent in prod; set them in Vercel first).

---

## Phase 3 (gated) — Dynamic QRIS through BRIAPI SNAP

**Precondition:** owner registers at `developers.bri.co.id`, creates an app with the *QRIS MPM Dinamis v1.1* product, uploads an RSA-2048 public key under "Manage Snap Key", and obtains sandbox `clientId`, `clientSecret`, `partnerId`, `channelId`, test `merchantId`/`terminalId`. Production keys come only after BRI's partnership process. Don't start 3.3+ before the sandbox call in 3.2 succeeds.

### Task 3.1 — Env + signing helpers `lib/payments/bri-snap.ts` (TDD on pure functions)

Env: `BRI_BASE_URL`, `BRI_CLIENT_ID`, `BRI_CLIENT_SECRET`, `BRI_PARTNER_ID`, `BRI_CHANNEL_ID`, `BRI_MERCHANT_ID`, `BRI_TERMINAL_ID`, `BRI_PRIVATE_KEY` (PEM, `\n`-escaped like `GOOGLE_PRIVATE_KEY`).

```ts
import { createHash, createHmac, createSign } from "node:crypto";

export function snapTimestamp(date = new Date()): string {
  // yyyy-MM-ddTHH:mm:ss+07:00 in WIB
  const wib = new Date(date.getTime() + 7 * 3600 * 1000);
  return wib.toISOString().replace(/\.\d{3}Z$/, "+07:00");
}

export function tokenSignature(privateKeyPem: string, clientId: string, timestamp: string): string {
  const signer = createSign("RSA-SHA256");
  signer.update(`${clientId}|${timestamp}`);
  return signer.sign(privateKeyPem.replace(/\\n/g, "\n"), "base64");
}

export function requestSignature(clientSecret: string, method: string, path: string, token: string, body: unknown, timestamp: string): string {
  const bodyHash = createHash("sha256").update(JSON.stringify(body)).digest("hex").toLowerCase();
  return createHmac("sha512", clientSecret).update(`${method}:${path}:${token}:${bodyHash}:${timestamp}`).digest("base64");
}
```

Tests: generate a throwaway RSA key in the test with `generateKeyPairSync`, sign, verify with `createVerify` → true; `requestSignature` is deterministic for fixed inputs (snapshot a known value); `snapTimestamp(new Date("2026-10-15T05:00:00Z"))` → `"2026-10-15T12:00:00+07:00"`.

### Task 3.2 — Token + generate + query client (same file)

```ts
type Amount = { value: string; currency: "IDR" };

async function accessToken(env: NodeJS.ProcessEnv): Promise<string> {
  const timestamp = snapTimestamp();
  const res = await fetch(`${env.BRI_BASE_URL}/snap/v1.0/access-token/b2b`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-TIMESTAMP": timestamp,
      "X-CLIENT-KEY": env.BRI_CLIENT_ID!,
      "X-SIGNATURE": tokenSignature(env.BRI_PRIVATE_KEY!, env.BRI_CLIENT_ID!, timestamp),
    },
    body: JSON.stringify({ grantType: "client_credentials" }),
  });
  const json = (await res.json()) as { accessToken?: string; responseMessage?: string };
  if (!res.ok || !json.accessToken) throw new Error(`BRI token failed: ${json.responseMessage ?? res.status}`);
  return json.accessToken;
}

async function snapPost<T>(env: NodeJS.ProcessEnv, path: string, body: unknown): Promise<T> {
  const token = await accessToken(env);
  const timestamp = snapTimestamp();
  const res = await fetch(`${env.BRI_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-TIMESTAMP": timestamp,
      "X-SIGNATURE": requestSignature(env.BRI_CLIENT_SECRET!, "POST", path, token, body, timestamp),
      "X-PARTNER-ID": env.BRI_PARTNER_ID!,
      "CHANNEL-ID": env.BRI_CHANNEL_ID!,
      "X-EXTERNAL-ID": String(Date.now()).slice(-12) + String(Math.floor(Math.random() * 1e6)).padStart(6, "0"),
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as T & { responseCode?: string; responseMessage?: string };
  if (!res.ok) throw new Error(`BRI ${path} failed: ${json.responseCode} ${json.responseMessage}`);
  return json;
}

export async function generateDynamicQr(env: NodeJS.ProcessEnv, partnerReferenceNo: string, totalIdr: number) {
  const amount: Amount = { value: `${totalIdr}.00`, currency: "IDR" };
  return snapPost<{ qrContent: string; referenceNo: string; partnerReferenceNo: string }>(env, "/v1.1/qr-dynamic-mpm/qr-mpm-generate-qr", {
    partnerReferenceNo, amount, merchantId: env.BRI_MERCHANT_ID, terminalId: env.BRI_TERMINAL_ID,
  });
}

export async function queryDynamicQr(env: NodeJS.ProcessEnv, originalReferenceNo: string) {
  return snapPost<{ latestTransactionStatus: string; transactionStatusDesc?: string; additionalInfo?: { issuerRrn?: string } }>(
    env, "/v1.1/qr-dynamic-mpm/qr-mpm-query",
    { originalReferenceNo, serviceCode: "17", additionalInfo: { terminalId: env.BRI_TERMINAL_ID } },
  );
}
```

**Sandbox smoke test** (script `scripts/bri-sandbox.mjs`, run with sandbox env vars): call `generateDynamicQr(env, "123456", 10000)` → expect a `qrContent` starting with `0002` and a 12-digit `referenceNo`; then `queryDynamicQr` → `latestTransactionStatus` `01` or `03` until the sandbox simulator marks it paid. If the field names differ from the live docs, fix them here before building UI. **Header name for the token call (`X-CLIENT-KEY`) and `partnerReferenceNo` length (docs say 6 in one table and 64 in another) must be confirmed against the Postman collection BRI provides.**

### Task 3.3 — Server routes

- `app/api/payments/qris/route.ts` `POST { total }` → `generateDynamicQr` with `partnerReferenceNo = last 6 digits of Date.now()`; returns `{ qrContent, referenceNo }`. Store `{referenceNo, total, createdAt}` in a `PaymentIntent` map in Sheets tab `Payments` (or Vercel KV later) so the webhook can find it.
- `app/api/payments/qris/[referenceNo]/route.ts` `GET` → `queryDynamicQr`, returns `{ status, paid: status === "00" }`.
- `app/api/payments/bri-notify/route.ts` `POST` — BRI's callback (`/snap/v1.1/qr/qr-mpm-notify` shape: `originalReferenceNo`, `latestTransactionStatus`, `amount`). Verify `X-SIGNATURE` with BRI's public key (obtained during onboarding) before trusting it; respond `{ responseCode: "2005200", responseMessage: "Successful" }`. Mark the intent paid. Auth: this route is public but signature-verified; add `pathname === "/api/payments/bri-notify"` to the proxy bypass list in `proxy.ts` next to `/api/backup`.

### Task 3.4 — POS UI

When `NEXT_PUBLIC_PAYMENT_PROVIDER === "bri-snap"`, the QRIS pane renders the dynamic QR (`npm i qrcode`; `QRCode.toDataURL(qrContent)`) instead of the static image, shows "Waiting for payment…", polls `GET /api/payments/qris/{ref}` every 3 s for up to 5 minutes, and on `paid` auto-fills `paymentRef = issuerRrn ?? referenceNo` and submits the sale. Manual entry stays available as an "Enter ref manually" link in case the network drops (offline-first rule still holds: the QR must be generated online, but the sale save never depends on BRI).

---

## Tests / validation summary

- Per task: failing test → `npx vitest run <file>` → implement → pass → `npx eslint && npx tsc --noEmit && npm run build` → commit.
- Phase 1 acceptance: a QRIS sale appears in `Sales` with `qris` in E and the ref in F; backup CSV has the `paymentRef` column; cash flow unchanged (regression: existing 26 tests still pass).
- Phase 2 acceptance: the fixture reconciles with the expected counts; `Reconciliation` tab populated.
- Phase 3 acceptance: sandbox generate → simulate pay → query returns `00` → POS auto-completes the sale.

## Risks, tradeoffs, open questions

- **Manual ref entry can be wrong or skipped.** Mitigation: require ≥ 6 digits, and Phase 2 catches mismatches daily. Consider making the ref optional *only* if the owner prefers speed over auditability (then relax Task 1.1's rule and matcher falls back to amount+time).
- **BRIAPI production access is a business process**, not a code task; timelines are weeks. Phase 1+2 keep the shop running meanwhile. Also, BRI dynamic QRIS attaches the merchant's `merchantId` — confirm the existing BRImerchant MID can be used with BRIAPI or whether BRI issues a separate one (affects settlement reports and Phase 2 matching).
- **MDR / fees**: QRIS MDR (0.3% for small merchants, 0.7% standard) is deducted at settlement; the POS records gross amounts. Reconciliation must compare gross, not net — check which the BRImerchant report shows (2.1).
- **Static QR stored per device** (IndexedDB): each cashier phone/tablet uploads it once. Alternative: store it in Vercel Blob and fetch on load; rejected for now because offline-first matters more than one-time convenience.
- **Sheets prod credentials are missing**; Phase 2 and all sync remain non-functional in production until `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_SHEET_ID` are set.
- **Open questions for the owner:** (1) Does the BRImerchant report export as XLSX, CSV or PDF, and can you share one day's file? (2) Should the cashier be allowed to confirm a QRIS sale without a ref? (3) Is dynamic QRIS worth a BRI partnership conversation at ~40 transactions/day, or is static + reconciliation enough? (4) Do you want "QRIS - BCA"-style issuer names recorded (only available from the report/BRIAPI, not from the cashier)?
