# Daily Sales Verification

Internal dashboard tracking daily sales across multiple Shopify stores and Square
accounts. Orders are synced from the source APIs into our own Postgres database on a
schedule; the dashboard only ever reads from that database, never live from
Shopify/Square.

Stores are **not** hardcoded — they are added at runtime through `/stores` and stored in
the database. The app works with zero stores configured.

## The 6AM IST reporting day

A "sales day" runs from **06:00:00 IST to 05:59:59 IST the next calendar day**
(Asia/Kolkata, UTC+05:30, no DST). Every order is stamped with a `report_date` at sync
time, and every total, grouping and report keys off that column — never off a UTC date or
a store-local date.

| Order created (IST)      | `report_date` |
| ------------------------ | ------------- |
| 15 Aug 2026, 02:30       | 2026-08-14    |
| 15 Aug 2026, 05:59:59    | 2026-08-14    |
| 15 Aug 2026, 06:00:00    | 2026-08-15    |
| 15 Aug 2026, 06:01       | 2026-08-15    |

The rule lives in one place — `lib/reportDate.ts` — with boundary tests in
`tests/reportDate.test.ts`.

## Stack

- Next.js 15 (App Router, TypeScript strict)
- Vercel Postgres (Neon) + Drizzle ORM
- Tailwind CSS v4
- Vercel Cron for the scheduled sync (`vercel.json`)
- Password gate via middleware + signed httpOnly cookie — no NextAuth, no user table

## Environment variables

Copy `.env.example` to `.env` and fill in:

| Variable               | Purpose                                                            |
| ---------------------- | ------------------------------------------------------------------ |
| `DATABASE_URL`         | Postgres connection string (use the **pooled** Neon URL)           |
| `DASHBOARD_PASSWORD`   | The single admin password for `/login`                             |
| `CRON_SECRET`          | Bearer token required by every `/api/cron/*` route                 |
| `TOKEN_ENCRYPTION_KEY` | 32-byte base64 key, AES-256-GCM for store API tokens at rest       |

Generate an encryption key with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Store API credentials are **not** env vars. They are entered per store in the admin UI and
stored encrypted in the database. They are decrypted server-side only, at sync time; the
admin UI shows only the last 4 characters.

## Local development

```bash
npm install
cp .env.example .env    # then fill it in
npm run db:migrate      # apply migrations
npm run dev
```

Other scripts:

```bash
npm run build       # production build, fails on any type error
npm test            # vitest — report-date, crypto and session unit tests
npm run typecheck   # tsc --noEmit
npm run db:generate # regenerate migrations after editing db/schema.ts
```

> **Note:** npm cannot resolve local binaries when the project path contains a `:`
> character, because it breaks `PATH` parsing. If `npm run dev` reports
> `next: command not found`, move the project to a path without a colon.

## Deploying

Push to GitHub and import the repo in Vercel. Set all four environment variables in the
Vercel project settings, then run `npm run db:migrate` once against the production
database. Vercel picks up the cron schedule from `vercel.json` and sends
`Authorization: Bearer $CRON_SECRET` automatically.

> The `*/15 * * * *` cron schedule requires a Vercel **Pro** plan. On Hobby, cron jobs run
> at most once per day.

## Layout

```
app/
  page.tsx                 daily sales report (Phase 4)
  stores/page.tsx          store management (Phase 2)
  login/                   password gate + server actions
  api/cron/sync/route.ts   scheduled sync, guarded by CRON_SECRET
db/
  schema.ts                stores, transactions, sync_state
  migrations/              generated SQL
lib/
  reportDate.ts            the 6AM IST rule
  crypto.ts                AES-256-GCM for store tokens
  session.ts               signed session cookie (edge-safe)
middleware.ts              password gate for everything but /login and /api/cron/*
```

## Build phases

1. **Foundation** — scaffold, schema + migration, login middleware, `reportDate` and
   `crypto` with tests, deploy the shell to Vercel. ✅
2. **Store management** — `/stores` add/edit/deactivate with live credential validation.
3. **Shopify sync** — `lib/shopify.ts`, sync pipeline, cron route, 30-day backfill.
4. **Daily sales report** — summary strip, transactions table, filters, day navigation.
5. **Square sync** — `lib/square.ts` including payment processing fees.
6. **Hardening** — error surfacing, empty states, mobile pass, pagination.
