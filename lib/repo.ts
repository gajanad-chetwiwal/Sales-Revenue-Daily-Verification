import { and, asc, desc, eq, sql } from 'drizzle-orm';

import { getDb } from '@/db';
import { stores, syncState, transactions, type Store } from '@/db/schema';

import { formatMinor, parseDecimalToMinor } from './money';
import type { ReportDate } from './reportDate';
import type { SalesOrder } from './salesOrder';

/** Database access. Server-side only — every caller is a server component,
 *  server action, route handler or script. */

export interface StoreSummary {
  storeId: string;
  storeName: string;
  platform: 'shopify' | 'square';
  currency: string;
  orderCount: number;
  gross: bigint;
  discounts: bigint;
  tax: bigint;
  shipping: bigint;
  fees: bigint;
  refunds: bigint;
  net: bigint;
}

export interface TransactionRow {
  id: string;
  storeId: string;
  storeName: string;
  orderNumber: string | null;
  createdAt: Date;
  currency: string;
  gross: bigint;
  discounts: bigint;
  tax: bigint;
  shipping: bigint;
  fees: bigint;
  refunds: bigint;
  net: bigint;
  status: string | null;
}

export async function listStores(): Promise<Store[]> {
  return getDb().select().from(stores).orderBy(asc(stores.name));
}

export async function listActiveStores(): Promise<Store[]> {
  return getDb().select().from(stores).where(eq(stores.active, true)).orderBy(asc(stores.name));
}

export async function getStore(id: string): Promise<Store | undefined> {
  const rows = await getDb().select().from(stores).where(eq(stores.id, id)).limit(1);
  return rows[0];
}

/** Per-store totals for one reporting day. Summed in Postgres NUMERIC, which
 *  is exact — then converted to minor units for display. */
export async function getDailySummary(reportDate: ReportDate): Promise<StoreSummary[]> {
  const rows = await getDb()
    .select({
      storeId: transactions.storeId,
      storeName: stores.name,
      platform: stores.platform,
      currency: transactions.currency,
      orderCount: sql<string>`count(*)`,
      gross: sql<string>`coalesce(sum(${transactions.grossAmount}), 0)`,
      discounts: sql<string>`coalesce(sum(${transactions.discounts}), 0)`,
      tax: sql<string>`coalesce(sum(${transactions.tax}), 0)`,
      shipping: sql<string>`coalesce(sum(${transactions.shipping}), 0)`,
      fees: sql<string>`coalesce(sum(${transactions.fees}), 0)`,
      refunds: sql<string>`coalesce(sum(${transactions.refunds}), 0)`,
      net: sql<string>`coalesce(sum(${transactions.netAmount}), 0)`,
    })
    .from(transactions)
    .innerJoin(stores, eq(stores.id, transactions.storeId))
    .where(eq(transactions.reportDate, reportDate))
    .groupBy(transactions.storeId, stores.name, stores.platform, transactions.currency)
    .orderBy(asc(stores.name));

  return rows.map((row) => ({
    storeId: row.storeId,
    storeName: row.storeName,
    platform: row.platform,
    currency: row.currency,
    orderCount: Number(row.orderCount),
    gross: parseDecimalToMinor(row.gross, row.currency),
    discounts: parseDecimalToMinor(row.discounts, row.currency),
    tax: parseDecimalToMinor(row.tax, row.currency),
    shipping: parseDecimalToMinor(row.shipping, row.currency),
    fees: parseDecimalToMinor(row.fees, row.currency),
    refunds: parseDecimalToMinor(row.refunds, row.currency),
    net: parseDecimalToMinor(row.net, row.currency),
  }));
}

export async function countDailyTransactions(
  reportDate: ReportDate,
  storeId?: string,
): Promise<number> {
  const where = storeId
    ? and(eq(transactions.reportDate, reportDate), eq(transactions.storeId, storeId))
    : eq(transactions.reportDate, reportDate);

  const rows = await getDb()
    .select({ total: sql<string>`count(*)` })
    .from(transactions)
    .where(where);

  return Number(rows[0]?.total ?? 0);
}

export async function getDailyTransactions(
  reportDate: ReportDate,
  options: { storeId?: string; limit?: number; offset?: number } = {},
): Promise<TransactionRow[]> {
  const { storeId, limit = 200, offset = 0 } = options;
  const where = storeId
    ? and(eq(transactions.reportDate, reportDate), eq(transactions.storeId, storeId))
    : eq(transactions.reportDate, reportDate);

  const rows = await getDb()
    .select({
      id: transactions.id,
      storeId: transactions.storeId,
      storeName: stores.name,
      orderNumber: transactions.orderNumber,
      createdAt: transactions.createdAt,
      currency: transactions.currency,
      gross: transactions.grossAmount,
      discounts: transactions.discounts,
      tax: transactions.tax,
      shipping: transactions.shipping,
      fees: transactions.fees,
      refunds: transactions.refunds,
      net: transactions.netAmount,
      status: transactions.financialStatus,
    })
    .from(transactions)
    .innerJoin(stores, eq(stores.id, transactions.storeId))
    .where(where)
    .orderBy(desc(transactions.createdAt))
    .limit(limit)
    .offset(offset);

  return rows.map((row) => ({
    ...row,
    gross: parseDecimalToMinor(row.gross, row.currency),
    discounts: parseDecimalToMinor(row.discounts, row.currency),
    tax: parseDecimalToMinor(row.tax, row.currency),
    shipping: parseDecimalToMinor(row.shipping, row.currency),
    fees: parseDecimalToMinor(row.fees, row.currency),
    refunds: parseDecimalToMinor(row.refunds, row.currency),
    net: parseDecimalToMinor(row.net, row.currency),
  }));
}

export interface SyncStateRow {
  storeId: string;
  storeName: string;
  active: boolean;
  lastSyncedAt: Date | null;
  lastStatus: 'ok' | 'error' | null;
  lastError: string | null;
}

export async function listSyncState(): Promise<SyncStateRow[]> {
  const rows = await getDb()
    .select({
      storeId: stores.id,
      storeName: stores.name,
      active: stores.active,
      lastSyncedAt: syncState.lastSyncedAt,
      lastStatus: syncState.lastStatus,
      lastError: syncState.lastError,
    })
    .from(stores)
    .leftJoin(syncState, eq(syncState.storeId, stores.id))
    .orderBy(asc(stores.name));

  return rows;
}

/** Upsert on (store_id, platform_id) — safe to re-run. report_date is always
 *  recomputed from the original created_at, so it never drifts on update. */
export async function upsertTransactions(orders: SalesOrder[]): Promise<number> {
  if (orders.length === 0) return 0;
  const db = getDb();
  const CHUNK = 250;
  let written = 0;

  for (let i = 0; i < orders.length; i += CHUNK) {
    const chunk = orders.slice(i, i + CHUNK);
    const values = chunk.map((order) => ({
      id: `${order.storeId}:${order.platformId}`,
      storeId: order.storeId,
      platformId: order.platformId,
      orderNumber: order.orderNumber,
      createdAt: order.createdAt,
      reportDate: order.reportDate,
      currency: order.currency,
      grossAmount: decimal(order.gross, order.currency),
      discounts: decimal(order.discounts, order.currency),
      tax: decimal(order.tax, order.currency),
      shipping: decimal(order.shipping, order.currency),
      fees: decimal(order.fees, order.currency),
      refunds: decimal(order.refunds, order.currency),
      netAmount: decimal(order.net, order.currency),
      financialStatus: order.status,
      syncedAt: new Date(),
    }));

    await db
      .insert(transactions)
      .values(values)
      .onConflictDoUpdate({
        target: [transactions.storeId, transactions.platformId],
        set: {
          orderNumber: sql`excluded.order_number`,
          createdAt: sql`excluded.created_at`,
          reportDate: sql`excluded.report_date`,
          currency: sql`excluded.currency`,
          grossAmount: sql`excluded.gross_amount`,
          discounts: sql`excluded.discounts`,
          tax: sql`excluded.tax`,
          shipping: sql`excluded.shipping`,
          fees: sql`excluded.fees`,
          refunds: sql`excluded.refunds`,
          netAmount: sql`excluded.net_amount`,
          financialStatus: sql`excluded.financial_status`,
          syncedAt: sql`excluded.synced_at`,
        },
      });

    written += chunk.length;
  }

  return written;
}

function decimal(minor: bigint, currency: string): string {
  return formatMinor(minor, currency);
}

export async function markSyncResult(
  storeId: string,
  result: { status: 'ok' | 'error'; error?: string; syncedAt?: Date },
): Promise<void> {
  await getDb()
    .insert(syncState)
    .values({
      storeId,
      lastSyncedAt: result.syncedAt ?? new Date(),
      lastStatus: result.status,
      lastError: result.error ?? null,
    })
    .onConflictDoUpdate({
      target: syncState.storeId,
      set: {
        lastSyncedAt: sql`excluded.last_synced_at`,
        lastStatus: sql`excluded.last_status`,
        lastError: sql`excluded.last_error`,
      },
    });
}

export async function getSyncState(storeId: string) {
  const rows = await getDb().select().from(syncState).where(eq(syncState.storeId, storeId)).limit(1);
  return rows[0];
}

/** Slugify a store name into a stable id, de-duplicated against existing ids. */
export async function generateStoreId(name: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'store';

  const existing = new Set((await getDb().select({ id: stores.id }).from(stores)).map((r) => r.id));
  if (!existing.has(base)) return base;

  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!existing.has(candidate)) return candidate;
  }
  throw new Error(`Could not derive a unique id for "${name}"`);
}

export async function createStore(store: {
  id: string;
  name: string;
  platform: 'shopify' | 'square';
  currency: string;
  shopifyDomain?: string | null;
  squareLocationId?: string | null;
  squareEnv?: 'production' | 'sandbox' | null;
  tokenEncrypted: string;
}): Promise<void> {
  const db = getDb();
  await db.insert(stores).values({
    id: store.id,
    name: store.name,
    platform: store.platform,
    currency: store.currency,
    shopifyDomain: store.shopifyDomain ?? null,
    squareLocationId: store.squareLocationId ?? null,
    squareEnv: store.squareEnv ?? null,
    tokenEncrypted: store.tokenEncrypted,
    active: true,
  });
  // Seed sync_state so the next cron run picks the store up and backfills.
  await db.insert(syncState).values({ storeId: store.id }).onConflictDoNothing();
}

export async function updateStore(
  id: string,
  changes: { name?: string; tokenEncrypted?: string },
): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (changes.name !== undefined) patch.name = changes.name;
  if (changes.tokenEncrypted !== undefined) patch.tokenEncrypted = changes.tokenEncrypted;
  if (Object.keys(patch).length === 0) return;
  await getDb().update(stores).set(patch).where(eq(stores.id, id));
}

/** No hard delete in v1 — deactivating stops syncing but keeps history. */
export async function setStoreActive(id: string, active: boolean): Promise<void> {
  await getDb().update(stores).set({ active }).where(eq(stores.id, id));
}
