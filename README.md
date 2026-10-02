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

Production deployment: https://coffee-shop-pos-orpin.vercel.app

The deployed serverless app requires Google OAuth before it serves the POS or sync APIs. It currently fails closed with an OAuth configuration message until the two OAuth values below are configured.

### Finish Google OAuth

1. In Google Cloud Console, select or create the business Google Cloud project.
2. Configure the OAuth consent screen as an internal/testing application and add `arief0303@gmail.com` as a test user if the app is external and still in testing.
3. Create an OAuth 2.0 Client ID of type **Web application**.
4. Add this exact authorised redirect URI:

```text
https://coffee-shop-pos-orpin.vercel.app/api/auth/google/callback
```

5. Add the Client ID and Client Secret to Vercel as the `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` production environment variables, then redeploy.

### Required Vercel environment variables

Already configured:

- `AUTH_SECRET` — generated server-side
- `ALLOWED_EMAILS=arief0303@gmail.com`
- `NEXT_PUBLIC_APP_URL=https://coffee-shop-pos-orpin.vercel.app`

Still required for functional authentication and Google Sheets sync:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY`
- `GOOGLE_SHEET_ID`

The OAuth client authenticates the cashier. The service-account credentials access the business Google Sheet. Both secret types stay in Vercel server-side environment variables and are never sent to the browser.
