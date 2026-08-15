import Link from 'next/link';

import { AppShell } from '@/app/components/AppShell';
import { EmptyState } from '@/app/components/EmptyState';
import { formatMinorGrouped } from '@/lib/money';
import { listTransactionMonths } from '@/lib/repo';
import { getCurrentReportDate } from '@/lib/reportDate';
import { DEFAULT_SHEET_CONFIG, formatBps } from '@/lib/sheet';
import { isValidMonth, loadMonthSheet, monthLabel, monthOf } from '@/lib/sheetData';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Sheet · Daily Sales Verification' };

interface PageProps {
  searchParams: Promise<{ month?: string }>;
}

export default async function SheetPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const config = DEFAULT_SHEET_CONFIG;
  const currentMonth = monthOf(getCurrentReportDate());

  let months: string[] = [];
  let loadError: string | null = null;
  try {
    months = await listTransactionMonths();
  } catch (error) {
    loadError = (error as Error).message;
  }
  if (!months.includes(currentMonth)) months = [currentMonth, ...months];

  const month = isValidMonth(params.month) ? params.month : (months[0] ?? currentMonth);

  let data: Awaited<ReturnType<typeof loadMonthSheet>> | null = null;
  if (!loadError) {
    try {
      data = await loadMonthSheet(month, config);
    } catch (error) {
      loadError = (error as Error).message;
    }
  }

  const base = config.baseCurrency;
  const quote = config.quoteCurrency;
  const money = (minor: bigint) => formatMinorGrouped(minor, base);
  const quoteMoney = (minor: bigint | null) =>
    minor === null ? '—' : formatMinorGrouped(minor, quote);

  return (
    <AppShell active="sheet">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            {data ? monthLabel(month) : 'Sheet'}
          </h1>
          <p className="muted mt-0.5 text-xs">
            Gross is every store combined for the reporting day. Team cost{' '}
            {config.teamCostPercent}% · transaction cost {config.transactionCostPercent}% · extra
            profit {config.extraProfitPercent}% · split between{' '}
            {config.partners.join(' and ')}.
          </p>
        </div>

        <form action="/sheet" method="get" className="flex items-center gap-2">
          <label htmlFor="month" className="muted text-xs">
            Month
          </label>
          <select id="month" name="month" defaultValue={month} className="input" style={{ width: 'auto' }}>
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
          <button type="submit" className="btn">
            Show
          </button>
        </form>
      </div>

      {loadError ? (
        <div className="mt-6">
          <EmptyState tone="critical" title="Could not build the sheet" body={<p>{loadError}</p>} />
        </div>
      ) : !data ? null : (
        <>
          {data.convertedCurrencies.length > 0 ? (
            <p className="muted mt-3 text-xs">
              Converted into {base} at each day&apos;s rate:{' '}
              {data.convertedCurrencies.join(', ')}.
            </p>
          ) : null}

          <div className="card mt-4 overflow-x-auto">
            <table className="w-full min-w-[1180px] text-sm">
              <thead>
                <tr className="table-head">
                  <th className="px-3 py-2.5 text-left">Day</th>
                  <th className="px-3 py-2.5 text-left">Date</th>
                  <th className="px-3 py-2.5 text-right">Gross Revenue</th>
                  <th className="px-3 py-2.5 text-right">Team Cost</th>
                  <th className="px-3 py-2.5 text-right">Revenue</th>
                  <th className="px-3 py-2.5 text-right">Transaction Cost</th>
                  <th className="px-3 py-2.5 text-right">Total Expense</th>
                  {config.partners.map((partner) => (
                    <th key={partner} className="px-3 py-2.5 text-right">
                      {partner} Earning
                    </th>
                  ))}
                  <th className="px-3 py-2.5 text-right">Profit %</th>
                  <th className="px-3 py-2.5 text-right">Expense %</th>
                  <th className="px-3 py-2.5 text-right">{quote}</th>
                  <th className="px-3 py-2.5 text-right">Extra Profit</th>
                  <th className="px-3 py-2.5 text-right">Extra Profit {quote}</th>
                </tr>
              </thead>
              <tbody>
                {data.sheet.rows.map((row) => {
                  const blank = row.gross === 0n;
                  return (
                    <tr
                      key={row.date}
                      className="row-hairline"
                      style={blank ? { color: 'var(--ink-muted)' } : undefined}
                    >
                      <td className="px-3 py-1.5 whitespace-nowrap">{row.weekday}</td>
                      <td className="num px-3 py-1.5 whitespace-nowrap">
                        {row.date.split('-').reverse().join('-')}
                        {row.rateCarriedForward ? (
                          <span
                            className="muted ml-1"
                            title={`FX markets closed — carried forward from ${row.rateAsOf}`}
                          >
                            *
                          </span>
                        ) : null}
                      </td>
                      <td className="num px-3 py-1.5 text-right font-medium">{money(row.gross)}</td>
                      <td className="num px-3 py-1.5 text-right">{money(row.teamCost)}</td>
                      <td className="num px-3 py-1.5 text-right">{money(row.revenue)}</td>
                      <td className="num px-3 py-1.5 text-right">{money(row.transactionCost)}</td>
                      <td className="num px-3 py-1.5 text-right">{money(row.totalExpense)}</td>
                      {row.partnerEarnings.map((amount, i) => (
                        <td key={i} className="num px-3 py-1.5 text-right">
                          {money(amount)}
                        </td>
                      ))}
                      <td className="num px-3 py-1.5 text-right">{formatBps(row.profitBps)}</td>
                      <td className="num px-3 py-1.5 text-right">{formatBps(row.expenseBps)}</td>
                      <td className="num px-3 py-1.5 text-right">{quoteMoney(row.inr)}</td>
                      <td className="num px-3 py-1.5 text-right">{money(row.extraProfit)}</td>
                      <td className="num px-3 py-1.5 text-right">{quoteMoney(row.extraProfitInr)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr
                  className="row-hairline font-semibold"
                  style={{ background: 'var(--surface-raised)' }}
                >
                  <td className="px-3 py-2.5" />
                  <td className="px-3 py-2.5 whitespace-nowrap">{monthLabel(month).split(' ')[0]}</td>
                  <td className="num px-3 py-2.5 text-right">{money(data.sheet.totals.gross)}</td>
                  <td className="num px-3 py-2.5 text-right">{money(data.sheet.totals.teamCost)}</td>
                  <td className="num px-3 py-2.5 text-right">{money(data.sheet.totals.revenue)}</td>
                  <td className="num px-3 py-2.5 text-right">
                    {money(data.sheet.totals.transactionCost)}
                  </td>
                  <td className="num px-3 py-2.5 text-right">
                    {money(data.sheet.totals.totalExpense)}
                  </td>
                  {data.sheet.totals.partnerEarnings.map((amount, i) => (
                    <td key={i} className="num px-3 py-2.5 text-right">
                      {money(amount)}
                    </td>
                  ))}
                  <td className="num px-3 py-2.5 text-right">
                    {formatBps(data.sheet.totals.profitBps)}
                  </td>
                  <td className="num px-3 py-2.5 text-right">
                    {formatBps(data.sheet.totals.expenseBps)}
                  </td>
                  <td className="num px-3 py-2.5 text-right">{quoteMoney(data.sheet.totals.inr)}</td>
                  <td className="num px-3 py-2.5 text-right">
                    {money(data.sheet.totals.extraProfit)}
                  </td>
                  <td className="num px-3 py-2.5 text-right">
                    {quoteMoney(data.sheet.totals.extraProfitInr)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="muted text-xs">
              * FX markets closed — that day carries the previous published rate. Rates from the
              ECB, stored per day so past months do not re-value themselves.
            </p>
            <div
              className="card-raised px-4 py-2.5 text-sm"
              title={`${quote} plus Extra Profit ${quote}`}
            >
              <span className="stat-label mr-3">Total</span>
              <span className="num font-semibold">
                {quoteMoney(data.sheet.totals.grandTotalInr)}
              </span>
            </div>
          </div>

          {data.sheet.totals.gross === 0n ? (
            <p className="muted mt-4 text-xs">
              No sales recorded this month.{' '}
              <Link href="/" style={{ color: 'var(--accent)' }}>
                Check the daily report
              </Link>{' '}
              or add a store.
            </p>
          ) : null}
        </>
      )}
    </AppShell>
  );
}
