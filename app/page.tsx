import Link from 'next/link';

import { AppShell } from '@/app/components/AppShell';
import { EmptyState } from '@/app/components/EmptyState';
import { StatTile } from '@/app/components/StatTile';
import { StatusPill } from '@/app/components/StatusPill';
import { StoreDot } from '@/app/components/StoreDot';
import { formatMinorGrouped } from '@/lib/money';
import {
  countDailyTransactions,
  getDailySummary,
  getDailyTransactions,
  listStores,
  listSyncState,
  type StoreSummary,
  type SyncStateRow,
  type TransactionRow,
} from '@/lib/repo';
import {
  formatIstDateTime,
  formatIstTime,
  formatReportDateLabel,
  getCurrentReportDate,
  isValidReportDate,
  nextReportDate,
  previousReportDate,
  reportDayRange,
  type ReportDate,
} from '@/lib/reportDate';
import { buildStoreColorMap, relativeTime } from '@/lib/ui';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 100;

interface PageProps {
  searchParams: Promise<{ date?: string; store?: string; page?: string }>;
}

function href(date: ReportDate, store?: string, page?: number): string {
  const params = new URLSearchParams({ date });
  if (store) params.set('store', store);
  if (page && page > 1) params.set('page', String(page));
  return `/?${params.toString()}`;
}

/** Combined totals are only meaningful within a currency — v1 does no FX. */
function groupByCurrency(summaries: StoreSummary[]): Map<string, StoreSummary[]> {
  const grouped = new Map<string, StoreSummary[]>();
  for (const summary of summaries) {
    const bucket = grouped.get(summary.currency) ?? [];
    bucket.push(summary);
    grouped.set(summary.currency, bucket);
  }
  return grouped;
}

function totals(summaries: StoreSummary[]) {
  return summaries.reduce(
    (acc, s) => ({
      orderCount: acc.orderCount + s.orderCount,
      gross: acc.gross + s.gross,
      discounts: acc.discounts + s.discounts,
      tax: acc.tax + s.tax,
      shipping: acc.shipping + s.shipping,
      fees: acc.fees + s.fees,
      refunds: acc.refunds + s.refunds,
      net: acc.net + s.net,
    }),
    { orderCount: 0, gross: 0n, discounts: 0n, tax: 0n, shipping: 0n, fees: 0n, refunds: 0n, net: 0n },
  );
}

export default async function DailyReportPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const reportDate: ReportDate = isValidReportDate(params.date)
    ? params.date
    : getCurrentReportDate();
  const storeFilter = params.store && params.store !== 'all' ? params.store : undefined;
  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);

  let storesList: Awaited<ReturnType<typeof listStores>> = [];
  let summaries: StoreSummary[] = [];
  let rows: TransactionRow[] = [];
  let syncStates: SyncStateRow[] = [];
  let total = 0;
  let loadError: string | null = null;

  try {
    [storesList, summaries, syncStates, total] = await Promise.all([
      listStores(),
      getDailySummary(reportDate),
      listSyncState(),
      countDailyTransactions(reportDate, storeFilter),
    ]);
    rows = await getDailyTransactions(reportDate, {
      storeId: storeFilter,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    });
  } catch (error) {
    loadError = (error as Error).message;
  }

  const colors = buildStoreColorMap(storesList.map((s) => s.id));
  const { start, endExclusive } = reportDayRange(reportDate);
  const isToday = reportDate === getCurrentReportDate();
  const visibleSummaries = storeFilter
    ? summaries.filter((s) => s.storeId === storeFilter)
    : summaries;
  const byCurrency = groupByCurrency(visibleSummaries);
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <AppShell active="report">
      {/* Day navigation ------------------------------------------------- */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            {formatReportDateLabel(reportDate)}
            {isToday ? <span className="muted ml-2 text-sm font-normal">· today</span> : null}
          </h1>
          <p className="muted mt-0.5 text-xs">
            {formatIstDateTime(start)} → {formatIstDateTime(new Date(endExclusive.getTime() - 1000))} IST
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link href={href(previousReportDate(reportDate), storeFilter)} className="btn" aria-label="Previous day">
            ← Prev
          </Link>
          <form action="/" method="get" className="flex items-center gap-2">
            {storeFilter ? <input type="hidden" name="store" value={storeFilter} /> : null}
            <input type="date" name="date" defaultValue={reportDate} className="input" style={{ width: 'auto' }} />
            <button type="submit" className="btn">
              Go
            </button>
          </form>
          <Link href={href(nextReportDate(reportDate), storeFilter)} className="btn" aria-label="Next day">
            Next →
          </Link>
          {!isToday ? (
            <Link href={href(getCurrentReportDate(), storeFilter)} className="btn">
              Today
            </Link>
          ) : null}
        </div>
      </div>

      {loadError ? (
        <div className="mt-6">
          <EmptyState
            tone="critical"
            title="Could not read the database"
            body={
              <>
                <p>{loadError}</p>
                <p className="mt-2">
                  Check that <code>DATABASE_URL</code> is set on the deployment and that migrations
                  have run.
                </p>
              </>
            }
          />
        </div>
      ) : storesList.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="No stores configured yet"
            body="Add a Shopify or Square store and the scheduled sync will backfill the last 30 days automatically — no redeploy needed."
            actionHref="/stores"
            actionLabel="Add your first store"
          />
        </div>
      ) : (
        <>
          {/* Totals ----------------------------------------------------- */}
          {byCurrency.size === 0 ? (
            <div className="mt-6">
              <EmptyState
                title="No transactions on this reporting day"
                body="Either nothing sold in this window, or the sync has not reached this day yet. Check the sync status below."
              />
            </div>
          ) : (
            <section className="mt-6 space-y-4">
              {[...byCurrency.entries()].map(([currency, group]) => {
                const t = totals(group);
                return (
                  <div key={currency} className="card overflow-hidden">
                    <div className="flex items-center gap-2 px-4 pt-3">
                      <h2 className="text-xs font-semibold uppercase tracking-wide secondary-ink">
                        Day totals
                      </h2>
                      <span className="chip">{currency}</span>
                      {byCurrency.size > 1 ? (
                        <span className="muted text-xs">
                          shown separately — no currency conversion
                        </span>
                      ) : null}
                    </div>
                    <div
                      className="mt-1 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8"
                      style={{ gap: '1px', background: 'var(--gridline)' }}
                    >
                      {[
                        <StatTile key="c" label="Transactions" count={t.orderCount} />,
                        <StatTile key="g" label="Gross" minor={t.gross} currency={currency} />,
                        <StatTile key="d" label="Discounts" minor={t.discounts} currency={currency} tone="negative" />,
                        <StatTile key="t" label="Tax" minor={t.tax} currency={currency} />,
                        <StatTile key="s" label="Shipping" minor={t.shipping} currency={currency} />,
                        <StatTile key="f" label="Fees" minor={t.fees} currency={currency} tone="negative" />,
                        <StatTile key="r" label="Refunds" minor={t.refunds} currency={currency} tone="negative" />,
                        <StatTile key="n" label="Net" minor={t.net} currency={currency} emphasis />,
                      ].map((tile, i) => (
                        <div key={i} style={{ background: 'var(--surface)' }}>
                          {tile}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </section>
          )}

          {/* Per-store ------------------------------------------------- */}
          {summaries.length > 0 ? (
            <section className="mt-4">
              <h2 className="stat-label mb-2">By store</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {summaries.map((summary) => (
                  <Link
                    key={summary.storeId}
                    href={href(reportDate, storeFilter === summary.storeId ? undefined : summary.storeId)}
                    className={`card-raised px-4 py-3 transition ${storeFilter === summary.storeId ? 'chip-active' : ''}`}
                    style={
                      storeFilter === summary.storeId
                        ? { boxShadow: `inset 0 0 0 1px ${colors.get(summary.storeId) ?? 'var(--accent)'}` }
                        : undefined
                    }
                  >
                    <div className="flex items-center gap-2">
                      <StoreDot color={colors.get(summary.storeId) ?? 'var(--ink-muted)'} />
                      <span className="truncate text-sm font-medium">{summary.storeName}</span>
                      <span className="muted ml-auto text-xs">{summary.currency}</span>
                    </div>
                    <div className="mt-2 flex items-baseline justify-between">
                      <span className="stat-value">
                        {formatMinorGrouped(summary.net, summary.currency)}
                      </span>
                      <span className="muted text-xs">
                        {summary.orderCount} {summary.orderCount === 1 ? 'order' : 'orders'}
                      </span>
                    </div>
                    <div className="muted mt-1 text-xs num">
                      gross {formatMinorGrouped(summary.gross, summary.currency)} · fees{' '}
                      {formatMinorGrouped(summary.fees, summary.currency)} · refunds{' '}
                      {formatMinorGrouped(summary.refunds, summary.currency)}
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          {/* Transactions ---------------------------------------------- */}
          <section className="mt-6">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h2 className="stat-label">Transactions</h2>
              <span className="muted text-xs">
                {total.toLocaleString('en-US')} on this day
                {storeFilter ? ' (filtered)' : ''}
              </span>
              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                <Link href={href(reportDate)} className={`chip ${!storeFilter ? 'chip-active' : ''}`}>
                  All stores
                </Link>
                {storesList.map((store) => (
                  <Link
                    key={store.id}
                    href={href(reportDate, store.id)}
                    className={`chip ${storeFilter === store.id ? 'chip-active' : ''}`}
                  >
                    <StoreDot color={colors.get(store.id) ?? 'var(--ink-muted)'} />
                    {store.name}
                  </Link>
                ))}
              </div>
            </div>

            <div className="card overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead>
                  <tr className="table-head">
                    <th className="px-3 py-2.5 text-left">Time (IST)</th>
                    <th className="px-3 py-2.5 text-left">Store</th>
                    <th className="px-3 py-2.5 text-left">Order #</th>
                    <th className="px-3 py-2.5 text-left">Channel</th>
                    <th className="px-3 py-2.5 text-right">Gross</th>
                    <th className="px-3 py-2.5 text-right">Discounts</th>
                    <th className="px-3 py-2.5 text-right">Tax</th>
                    <th className="px-3 py-2.5 text-right">Shipping</th>
                    <th className="px-3 py-2.5 text-right">Fees</th>
                    <th className="px-3 py-2.5 text-right">Refunds</th>
                    <th className="px-3 py-2.5 text-right">Net</th>
                    <th className="px-3 py-2.5 text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr className="row-hairline">
                      <td colSpan={12} className="muted px-3 py-8 text-center text-sm">
                        No transactions to show.
                      </td>
                    </tr>
                  ) : (
                    rows.map((row) => (
                      <tr key={row.id} className="row-hairline">
                        <td className="num px-3 py-2 whitespace-nowrap secondary-ink">
                          {formatIstTime(row.createdAt)}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className="flex items-center gap-2">
                            <StoreDot color={colors.get(row.storeId) ?? 'var(--ink-muted)'} />
                            {row.storeName}
                            <span className="muted text-xs">{row.currency}</span>
                          </span>
                        </td>
                        <td className="num px-3 py-2 whitespace-nowrap secondary-ink">
                          {row.orderNumber ?? '—'}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {row.channel ? (
                            <span className="chip">{row.channel === 'pos' ? 'POS' : 'Online'}</span>
                          ) : (
                            <span className="muted text-xs">—</span>
                          )}
                        </td>
                        <td className="num px-3 py-2 text-right">
                          {formatMinorGrouped(row.gross, row.currency)}
                        </td>
                        <td className="num px-3 py-2 text-right secondary-ink">
                          {formatMinorGrouped(row.discounts, row.currency)}
                        </td>
                        <td className="num px-3 py-2 text-right secondary-ink">
                          {formatMinorGrouped(row.tax, row.currency)}
                        </td>
                        <td className="num px-3 py-2 text-right secondary-ink">
                          {formatMinorGrouped(row.shipping, row.currency)}
                        </td>
                        <td className="num px-3 py-2 text-right secondary-ink">
                          {formatMinorGrouped(row.fees, row.currency)}
                        </td>
                        <td
                          className="num px-3 py-2 text-right"
                          style={row.refunds > 0n ? { color: 'var(--serious)' } : undefined}
                        >
                          {formatMinorGrouped(row.refunds, row.currency)}
                        </td>
                        <td className="num px-3 py-2 text-right font-medium">
                          {formatMinorGrouped(row.net, row.currency)}
                        </td>
                        <td className="px-3 py-2">
                          <StatusPill status={row.status} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {lastPage > 1 ? (
              <div className="mt-3 flex items-center justify-between text-xs">
                <span className="muted">
                  Page {page} of {lastPage}
                </span>
                <div className="flex gap-2">
                  {page > 1 ? (
                    <Link href={href(reportDate, storeFilter, page - 1)} className="btn">
                      ← Newer
                    </Link>
                  ) : null}
                  {page < lastPage ? (
                    <Link href={href(reportDate, storeFilter, page + 1)} className="btn">
                      Older →
                    </Link>
                  ) : null}
                </div>
              </div>
            ) : null}
          </section>

          {/* Sync status ------------------------------------------------ */}
          <section className="mt-6">
            <h2 className="stat-label mb-2">Sync status</h2>
            <div className="card divide-y" style={{ borderColor: 'var(--hairline)' }}>
              {syncStates.map((state) => {
                const failed = state.lastStatus === 'error';
                return (
                  <div
                    key={state.storeId}
                    className="row-hairline flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm first:border-t-0"
                  >
                    <StoreDot color={colors.get(state.storeId) ?? 'var(--ink-muted)'} />
                    <span className="font-medium">{state.storeName}</span>
                    {!state.active ? <span className="chip">inactive</span> : null}
                    <span
                      className="status-pill"
                      style={{ color: failed ? 'var(--critical)' : 'var(--ink-secondary)' }}
                    >
                      <span
                        aria-hidden="true"
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: 999,
                          background: failed
                            ? 'var(--critical)'
                            : state.lastSyncedAt
                              ? 'var(--good)'
                              : 'var(--warning)',
                        }}
                      />
                      {failed ? 'Error' : state.lastSyncedAt ? 'OK' : 'Never synced'}
                    </span>
                    <span className="muted text-xs">
                      last sync {relativeTime(state.lastSyncedAt)}
                    </span>
                    {failed && state.lastError ? (
                      <span
                        className="w-full text-xs sm:w-auto"
                        style={{ color: 'var(--critical)' }}
                      >
                        {state.lastError}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}
    </AppShell>
  );
}
