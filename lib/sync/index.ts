import type { Store } from '@/db/schema';

import { decryptToken } from '../crypto';
import { listActiveStores, markSyncResult, getSyncState, upsertTransactions } from '../repo';
import type { SalesOrder } from '../salesOrder';
import { fetchShopifyOrders, type StoreRef } from '../shopify';
import { fetchSquareOrders } from '../square';

/**
 * Sync orchestration.
 *
 * Two modes per store, chosen by whether sync_state.last_synced_at exists:
 *
 *   - **Backfill** (first ever sync): walk the last 30 days in 7-day chunks,
 *     oldest first, advancing last_synced_at after each chunk. If the run is
 *     cut short — Vercel function timeout, a deploy, anything — the next run
 *     picks up exactly where this one stopped.
 *   - **Incremental**: everything updated since last_synced_at, minus a
 *     one-hour overlap buffer so nothing slips through the gap between runs.
 *
 * One store failing never blocks the others: each is wrapped independently and
 * its error is recorded in sync_state for the dashboard to surface.
 */

const OVERLAP_MS = 60 * 60 * 1000;
const BACKFILL_DAYS = 30;
const BACKFILL_CHUNK_MS = 7 * 24 * 60 * 60 * 1000;

/** Leave headroom under the function's maxDuration so state gets written. */
const DEFAULT_DEADLINE_MS = 45_000;

export interface StoreSyncResult {
  storeId: string;
  storeName: string;
  status: 'ok' | 'error' | 'partial';
  ordersWritten: number;
  mode: 'backfill' | 'incremental';
  error?: string;
}

export interface SyncRunResult {
  ranAt: string;
  durationMs: number;
  storesSynced: number;
  storesFailed: number;
  ordersWritten: number;
  results: StoreSyncResult[];
}

function toStoreRef(store: Store): StoreRef {
  return { id: store.id, name: store.name, currency: store.currency };
}

async function fetchWindow(
  store: Store,
  token: string,
  window: { updatedSince?: Date; createdFrom?: Date; createdUntilExclusive?: Date },
): Promise<SalesOrder[]> {
  const ref = toStoreRef(store);

  if (store.platform === 'shopify') {
    if (!store.shopifyDomain) {
      throw new Error(`Store "${store.id}" is missing its Shopify domain`);
    }
    return fetchShopifyOrders(
      ref,
      {
        domain: store.shopifyDomain,
        accessToken: token,
        ...(store.shopifyClientId ? { clientId: store.shopifyClientId } : {}),
      },
      window,
    );
  }

  if (!store.squareLocationId) {
    throw new Error(`Store "${store.id}" is missing its Square location id`);
  }
  return fetchSquareOrders(
    ref,
    {
      accessToken: token,
      locationId: store.squareLocationId,
      environment: store.squareEnv ?? 'production',
    },
    window,
  );
}

async function syncStore(store: Store, deadline: number): Promise<StoreSyncResult> {
  const base = { storeId: store.id, storeName: store.name };

  let token: string;
  try {
    token = decryptToken(store.tokenEncrypted);
  } catch (error) {
    const message = `Could not decrypt the stored API token — TOKEN_ENCRYPTION_KEY may have changed. (${(error as Error).message})`;
    await markSyncResult(store.id, { status: 'error', error: message });
    return { ...base, status: 'error', ordersWritten: 0, mode: 'incremental', error: message };
  }

  const state = await getSyncState(store.id);
  const mode: 'backfill' | 'incremental' = state?.lastSyncedAt ? 'incremental' : 'backfill';

  try {
    if (mode === 'incremental') {
      const startedAt = new Date();
      const updatedSince = new Date(state!.lastSyncedAt!.getTime() - OVERLAP_MS);
      const orders = await fetchWindow(store, token, { updatedSince });
      const written = await upsertTransactions(orders);
      // Stamp the moment the fetch *began*, so orders updated mid-fetch are
      // re-examined next run rather than skipped.
      await markSyncResult(store.id, { status: 'ok', syncedAt: startedAt });
      return { ...base, status: 'ok', ordersWritten: written, mode };
    }

    // Backfill, oldest chunk first.
    let cursor = new Date(Date.now() - BACKFILL_DAYS * 24 * 60 * 60 * 1000);
    const now = new Date();
    let written = 0;

    while (cursor < now) {
      const chunkEnd = new Date(Math.min(cursor.getTime() + BACKFILL_CHUNK_MS, now.getTime()));
      const orders = await fetchWindow(store, token, {
        createdFrom: cursor,
        createdUntilExclusive: chunkEnd,
      });
      written += await upsertTransactions(orders);
      await markSyncResult(store.id, { status: 'ok', syncedAt: chunkEnd });
      cursor = chunkEnd;

      if (Date.now() > deadline && cursor < now) {
        return {
          ...base,
          status: 'partial',
          ordersWritten: written,
          mode,
          error: 'Backfill paused at the time limit; the next scheduled run resumes from here.',
        };
      }
    }

    return { ...base, status: 'ok', ordersWritten: written, mode };
  } catch (error) {
    const message = (error as Error).message.slice(0, 500);
    await markSyncResult(store.id, { status: 'error', error: message });
    return { ...base, status: 'error', ordersWritten: 0, mode, error: message };
  }
}

export async function runSync(
  options: { storeIds?: string[]; deadlineMs?: number } = {},
): Promise<SyncRunResult> {
  const startedAt = Date.now();
  const deadline = startedAt + (options.deadlineMs ?? DEFAULT_DEADLINE_MS);

  const all = await listActiveStores();
  const targets = options.storeIds?.length
    ? all.filter((store) => options.storeIds!.includes(store.id))
    : all;

  const results: StoreSyncResult[] = [];
  for (const store of targets) {
    results.push(await syncStore(store, deadline));
  }

  return {
    ranAt: new Date(startedAt).toISOString(),
    durationMs: Date.now() - startedAt,
    storesSynced: results.filter((r) => r.status !== 'error').length,
    storesFailed: results.filter((r) => r.status === 'error').length,
    ordersWritten: results.reduce((sum, r) => sum + r.ordersWritten, 0),
    results,
  };
}
