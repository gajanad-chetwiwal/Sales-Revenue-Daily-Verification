import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export type Platform = 'shopify' | 'square';
export type SquareEnv = 'production' | 'sandbox';
export type SyncStatus = 'ok' | 'error';

/**
 * Stores are added at runtime through /stores — never hardcoded, never read
 * from env. The system must work with zero rows here.
 */
export const stores = pgTable('stores', {
  /** Slug generated from the store name, e.g. `store-1`. */
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  platform: text('platform').$type<Platform>().notNull(),
  /** ISO 4217 code — reports never convert between currencies in v1. */
  currency: text('currency').notNull(),

  // Shopify-specific
  shopifyDomain: text('shopify_domain'),

  // Square-specific
  squareLocationId: text('square_location_id'),
  squareEnv: text('square_env').$type<SquareEnv>(),

  // Shared
  /** AES-256-GCM ciphertext of the platform API token. Never leaves the server. */
  tokenEncrypted: text('token_encrypted').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One row per platform order. Money columns are NUMERIC and are read/written
 * as strings — never as JS floats.
 */
export const transactions = pgTable(
  'transactions',
  {
    /** `{store_id}:{platform_order_id}` */
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id),
    platformId: text('platform_id').notNull(),
    orderNumber: text('order_number'),
    /** Original timestamp from the platform, stored as-is. */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    /** Derived from createdAt via the 6AM IST rule at sync time. */
    reportDate: date('report_date', { mode: 'string' }).notNull(),
    currency: text('currency').notNull(),

    grossAmount: numeric('gross_amount', { precision: 12, scale: 2, mode: 'string' })
      .notNull()
      .default('0'),
    discounts: numeric('discounts', { precision: 12, scale: 2, mode: 'string' })
      .notNull()
      .default('0'),
    tax: numeric('tax', { precision: 12, scale: 2, mode: 'string' }).notNull().default('0'),
    shipping: numeric('shipping', { precision: 12, scale: 2, mode: 'string' })
      .notNull()
      .default('0'),
    /** Payment processing fees. Always 0 for Shopify — the API does not expose them. */
    fees: numeric('fees', { precision: 12, scale: 2, mode: 'string' }).notNull().default('0'),
    refunds: numeric('refunds', { precision: 12, scale: 2, mode: 'string' })
      .notNull()
      .default('0'),
    /** gross - discounts - refunds - fees */
    netAmount: numeric('net_amount', { precision: 12, scale: 2, mode: 'string' })
      .notNull()
      .default('0'),

    financialStatus: text('financial_status'),
    /** Full API payload, kept for debugging reconciliation mismatches. */
    raw: jsonb('raw'),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('transactions_store_id_platform_id_key').on(table.storeId, table.platformId),
    index('idx_tx_report_date').on(table.reportDate, table.storeId),
  ],
);

/** Per-store sync bookkeeping. A NULL lastSyncedAt triggers the 30-day backfill. */
export const syncState = pgTable('sync_state', {
  storeId: text('store_id')
    .primaryKey()
    .references(() => stores.id, { onDelete: 'cascade' }),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  lastStatus: text('last_status').$type<SyncStatus>(),
  lastError: text('last_error'),
});

export type Store = typeof stores.$inferSelect;
export type NewStore = typeof stores.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type SyncState = typeof syncState.$inferSelect;
export type NewSyncState = typeof syncState.$inferInsert;

/** Re-exported so migrations and raw queries can share the same import. */
export { sql };
