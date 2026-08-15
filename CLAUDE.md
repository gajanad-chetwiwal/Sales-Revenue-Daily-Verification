# CLAUDE.md — Multi-Store Sales Dashboard

## Project Overview

Internal sales dashboard tracking daily sales across multiple Shopify stores and Square
accounts. Deployed on Vercel. Data is synced from source APIs into our own Postgres
database on a schedule; the dashboard only ever reads from our database, never live from
Shopify/Square.

Stores are NOT hardcoded. All stores are added dynamically through an admin page in the
app and stored in the database. The system must work with zero stores configured and
scale as stores are added.

This is an internal tool. No public signups. Single admin login.

## Reporting Day — 6AM IST Rule (CRITICAL)

A "sales day" is defined as 6:00 AM IST to 5:59:59 AM IST the next calendar day
(IST = Asia/Kolkata, UTC+5:30, no DST).

Every order is assigned a `report_date` at sync time: take the order's `created_at` in
Asia/Kolkata; if the local time is before 06:00, the order belongs to the previous
calendar date, otherwise to that date.

Example: an order at 2:30 AM IST on Aug 15 → `report_date` = 2026-08-14. An order at
6:01 AM IST on Aug 15 → `report_date` = 2026-08-15.

ALL daily grouping, totals, and reports use `report_date`. Never group by UTC date or
store-local date.

Implement this once as `getReportDate(createdAt: Date): string` in `lib/reportDate.ts`
with unit tests covering the boundary (05:59:59 vs 06:00:00 IST).

## Tech Stack

- **Framework:** Next.js 15 (App Router, TypeScript)
- **Hosting:** Vercel
- **Database:** Vercel Postgres (Neon) with Drizzle ORM
- **Styling:** Tailwind CSS
- **Scheduled sync:** Vercel Cron (`vercel.json`)
- **Auth:** Simple password gate via middleware + `DASHBOARD_PASSWORD` env var (httpOnly
  cookie session). Do NOT add NextAuth or user tables.

## Environment Variables

```
DATABASE_URL=
DASHBOARD_PASSWORD=
CRON_SECRET=            # required Bearer token check on all /api/cron/* routes
TOKEN_ENCRYPTION_KEY=   # 32-byte base64 key, AES-256-GCM for store API tokens at rest
```

Store API credentials are NOT env vars — they are entered per store in the admin UI and
stored encrypted in the database (AES-256-GCM using `TOKEN_ENCRYPTION_KEY`). Decrypt only
server-side at sync time. Never send decrypted tokens to the client; the admin UI shows
only the last 4 characters.

## Database Schema

```sql
CREATE TABLE stores (
  id            TEXT PRIMARY KEY,        -- slug, e.g. 'store-1' (generated from name)
  name          TEXT NOT NULL,
  platform      TEXT NOT NULL,           -- 'shopify' | 'square'
  currency      TEXT NOT NULL,           -- ISO code, e.g. 'USD', 'GBP', 'DKK'
  -- shopify fields
  shopify_domain TEXT,                   -- xxxx.myshopify.com
  -- square fields
  square_location_id TEXT,
  square_env    TEXT,                    -- 'production' | 'sandbox'
  -- shared
  token_encrypted TEXT NOT NULL,         -- AES-256-GCM ciphertext of the API token
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE transactions (
  id              TEXT PRIMARY KEY,      -- '{store_id}:{platform_order_id}'
  store_id        TEXT NOT NULL REFERENCES stores(id),
  platform_id     TEXT NOT NULL,
  order_number    TEXT,
  created_at      TIMESTAMPTZ NOT NULL,  -- original timestamp from platform
  report_date     DATE NOT NULL,         -- per the 6AM IST rule, computed at sync time
  currency        TEXT NOT NULL,
  gross_amount    NUMERIC(12,2) NOT NULL DEFAULT 0,   -- items total before discounts
  discounts       NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax             NUMERIC(12,2) NOT NULL DEFAULT 0,
  shipping        NUMERIC(12,2) NOT NULL DEFAULT 0,
  fees            NUMERIC(12,2) NOT NULL DEFAULT 0,   -- payment processing fees
  refunds         NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_amount      NUMERIC(12,2) NOT NULL DEFAULT 0,   -- gross - discounts - refunds - fees
  financial_status TEXT,
  raw             JSONB,                 -- full API payload for debugging
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (store_id, platform_id)
);

CREATE INDEX idx_tx_report_date ON transactions (report_date, store_id);

CREATE TABLE sync_state (
  store_id       TEXT PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  last_synced_at TIMESTAMPTZ,
  last_status    TEXT,                   -- 'ok' | 'error'
  last_error     TEXT
);
```

All syncs are upserts on `(store_id, platform_id)` — safe to re-run; refunds and fee
updates modify existing rows and `report_date` is recomputed from the original
`created_at` (it never changes on update).

## Sync Logic

### Cron route: `/api/cron/sync`

- Runs every 15 minutes. Must verify `Authorization: Bearer ${CRON_SECRET}`, return 401
  otherwise.
- Loads all active stores from the DB and syncs each: fetch orders updated since
  `sync_state.last_synced_at` minus a 1-hour overlap buffer, upsert, update `sync_state`.
- One store failing must not block the others — per-store try/catch, errors recorded in
  `sync_state`.
- Newly added stores with `last_synced_at = NULL` get an initial backfill of the last 30
  days automatically (paged, resumable). Deeper history via
  `scripts/backfill.ts --store <id> --since <date>`.

### Shopify (per store)

- GraphQL Admin API, version 2026-01, endpoint
  `https://{shopify_domain}/admin/api/2026-01/graphql.json`, header
  `X-Shopify-Access-Token` (decrypted at call time).
- `orders(query: "updated_at:>=...", first: 100)` with cursor pagination. Pull: id, name,
  createdAt, currencyCode, subtotal, totalDiscounts, totalTax, totalShipping,
  totalRefunded, displayFinancialStatus.
- Shopify does not expose payment processing fees through this API → `fees = 0` for
  Shopify rows.
- Respect cost-based rate limiting: back off on THROTTLED errors.
- Exclude test orders.

### Square (per store)

- Official `square` npm SDK, token decrypted at call time, filtered to the store's
  `square_location_id`.
- `SearchOrders` filtered by `updated_at`, states COMPLETED and OPEN with payments.
- For each order, fetch linked payments and capture `processing_fee` amounts into `fees`.
- Square amounts are in cents — divide by 100 before storing.

## Pages

All pages are server components reading from Postgres. Only three pages plus auth — do
not add more.

### `/` — Daily Sales Report

The main screen. A date picker defaulting to the current report day (per the 6AM IST
rule — before 6AM IST, "today" is yesterday's date).

For the selected `report_date`:

- **Summary strip:** total transactions, gross, tax, fees, refunds, net — combined and
  per store (each store shows its own currency; no FX conversion in v1).
- **Transactions table** — every transaction for that report day, all stores interleaved,
  sorted by `created_at` descending. Columns: Time (shown in IST), Store name, Order #,
  Gross, Discounts, Tax, Shipping, Fees, Refunds, Net, Status.
- Filter by store; badge per store showing that day's subtotal.
- **Sync status footer:** last sync time per store from `sync_state`, red badge on error.
- Previous/next day navigation.

### `/stores` — Store Management

- List of configured stores: name, platform, currency, active toggle, last sync status,
  token shown as `••••1234`.
- Add store form: name, platform (shopify | square), currency, then platform-specific
  fields — Shopify: domain + Admin API token; Square: access token + location ID +
  environment.
- On save: validate the credentials with a live test call (Shopify `shop` query / Square
  `ListLocations`) before accepting; encrypt the token; create the `sync_state` row so the
  next cron run picks it up and backfills 30 days.
- Edit (replace token, rename) and deactivate. No hard delete in v1 — deactivating stops
  syncing but keeps transaction history.

### `/login`

Password form → sets session cookie. Middleware protects everything else, including API
routes except `/api/cron/*` (which use `CRON_SECRET` instead).

## Conventions

- TypeScript strict mode. No `any` in sync code — type the API responses.
- Never do float arithmetic on money in JS — use integer minor units or a decimal
  library, store as NUMERIC.
- API clients in `lib/shopify.ts`, `lib/square.ts`; crypto helpers in `lib/crypto.ts`;
  report-date logic in `lib/reportDate.ts`; sync orchestration in `lib/sync/`.
- Config-driven throughout: nothing anywhere in the codebase may reference a specific
  store name.
- Commit after each working phase. Do not start a phase until the previous one runs on
  Vercel, not just locally.

## Build Phases

**Phase 1 — Foundation.** Scaffold Next.js + Tailwind + Drizzle. Schema + migration.
Login middleware. `lib/reportDate.ts` with boundary unit tests. `lib/crypto.ts`
(AES-256-GCM encrypt/decrypt) with tests. Deploy empty shell to Vercel with env vars set.

**Phase 2 — Store Management.** Build `/stores` end to end: add/edit/deactivate,
credential validation test-call, token encryption, masked display.

**Phase 3 — Shopify sync.** `lib/shopify.ts` + sync pipeline + cron route with
`CRON_SECRET` check + auto 30-day backfill for new stores + `scripts/backfill.ts`. Add one
real Shopify store via the UI and verify a sample report day's totals against the Shopify
admin (remember the admin groups by store-local day, so compare individual orders, not
admin daily totals).

**Phase 4 — Daily Sales Report page.** Build `/` with the summary strip, transactions
table, store filter, and day navigation. Verify orders around the 6AM IST boundary land on
the correct `report_date`.

**Phase 5 — Square sync.** `lib/square.ts` + payments/fee capture. Add a Square store via
the UI, verify fees populate.

**Phase 6 — Hardening.** Sync error surfacing on the report page, empty/loading states,
mobile layout pass, pagination on the transactions table for high-volume days.

## Verification Checklist (per phase)

- `npm run build` passes with no type errors
- `getReportDate` boundary tests pass (05:59:59 IST → previous day, 06:00:00 IST → same
  day)
- Cron route rejects requests without the correct `CRON_SECRET`
- No decrypted token or `TOKEN_ENCRYPTION_KEY` ever reaches a client bundle or client
  component
- Adding a store through the UI with bad credentials is rejected; with valid credentials,
  it syncs on the next cron run without a redeploy
