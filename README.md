# Bean Counter POS

Offline-first coffee shop point-of-sale PWA. The browser owns the working copy in IndexedDB; Next.js serverless route handlers are the only layer allowed to access Google Sheets.

## Current scope

- Single cashier/browser
- Coffee, tea, and food menu inventory
- Cash sales only
- Local checkout works without internet
- Products and sales sync to Google Sheets when online
- No payment gateway, receipt printer, multi-user authentication, or reporting dashboard yet

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev -- --hostname 127.0.0.1 --port 10020
```

Open http://127.0.0.1:10020.

Without Google credentials, the POS still works locally. Product and sale changes remain in IndexedDB and the UI reports that Sheets sync is unavailable.

## Google Sheets setup

Create a spreadsheet with these tabs and header rows:

`Products` row 1:

```text
id | name | sku | price | stock | category | updatedAt
```

`Sales` row 1:

```text
id | items | total | timestamp | paymentMethod | operationId
```

Then:

1. Enable Google Sheets API in Google Cloud.
2. Create a service account.
3. Share the spreadsheet with the service-account email as Editor.
4. Put the service-account email, private key, and spreadsheet ID in `.env.local`.
5. Restart the Next.js server.

The private key is consumed only by `app/api/products/route.ts` and `app/api/sync/route.ts`; it is never bundled for the browser.

## Offline model

IndexedDB stores three things in the `pos-system` database:

- `products`: the local menu and current local stock
- `sales`: completed cash sales
- `syncQueue`: immutable operations waiting for the serverless API

Checkout writes the sale and stock updates locally before attempting a network request. When connectivity returns, the queue is sent to `/api/sync`. Google Sheets writes are idempotent by sale/product ID, so retrying a request does not append the same sale twice.

The service worker caches the application shell. Browser storage can still be cleared or evicted by the browser; this is not a replacement for a durable server database.

## Verification

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
```

## Deployment

Deploy as a normal Node-compatible Next.js application on Vercel, Cloud Run, or another serverless host. Configure these server-side environment variables in the deployment platform:

- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY`
- `GOOGLE_SHEET_ID`

The current prototype has no authentication on the sync routes. Keep the deployment private or place it behind an access-control layer before exposing it to the public internet. Add Google OAuth or another server-side session boundary before production use.
