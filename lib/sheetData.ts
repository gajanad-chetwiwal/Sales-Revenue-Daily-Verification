import { ensureRates } from './fx';
import { mulMinorByDecimal } from './money';
import { getDailyGrossByCurrency } from './repo';
import { addReportDays, type ReportDate } from './reportDate';
import { computeSheet, DEFAULT_SHEET_CONFIG, type SheetConfig } from './sheet';

/** `YYYY-MM` */
export type SheetMonth = string;

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isValidMonth(value: unknown): value is SheetMonth {
  return typeof value === 'string' && MONTH_PATTERN.test(value);
}

export function monthOf(date: ReportDate): SheetMonth {
  return date.slice(0, 7);
}

export function monthBounds(month: SheetMonth): { first: ReportDate; last: ReportDate } {
  const [year, m] = month.split('-').map(Number) as [number, number];
  const first = `${month}-01`;
  // Day 0 of the next month is the last day of this one.
  const lastDay = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return { first, last: `${month}-${String(lastDay).padStart(2, '0')}` };
}

export function monthLabel(month: SheetMonth): string {
  const [year, m] = month.split('-').map(Number) as [number, number];
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' })
    .format(new Date(Date.UTC(year, m - 1, 1)));
}

function eachDay(first: ReportDate, last: ReportDate): ReportDate[] {
  const days: ReportDate[] = [];
  for (let d = first; d <= last; d = addReportDays(d, 1)) days.push(d);
  return days;
}

export interface MonthSheet {
  month: SheetMonth;
  sheet: ReturnType<typeof computeSheet>;
  /** Currencies other than the base that had to be converted in. */
  convertedCurrencies: string[];
  missingRateDays: number;
}

/**
 * Build the monthly sheet: one row per calendar day, gross summed across every
 * store, converted into the sheet's base currency where a store trades in
 * something else.
 */
export async function loadMonthSheet(
  month: SheetMonth,
  config: SheetConfig = DEFAULT_SHEET_CONFIG,
): Promise<MonthSheet> {
  const { first, last } = monthBounds(month);
  const days = eachDay(first, last);

  const [grossRows, quoteRates] = await Promise.all([
    getDailyGrossByCurrency(first, last),
    ensureRates(first, last, config.baseCurrency, config.quoteCurrency),
  ]);

  const foreign = [
    ...new Set(grossRows.map((r) => r.currency).filter((c) => c !== config.baseCurrency)),
  ].sort();

  // Only fetch conversion rates for currencies that actually appear.
  const foreignRates = new Map<string, Awaited<ReturnType<typeof ensureRates>>>();
  for (const currency of foreign) {
    foreignRates.set(currency, await ensureRates(first, last, currency, config.baseCurrency));
  }

  const grossByDay = new Map<ReportDate, bigint>();
  for (const row of grossRows) {
    let amount = row.gross;
    if (row.currency !== config.baseCurrency) {
      const rate = foreignRates.get(row.currency)?.get(row.reportDate)?.rate;
      // Without a rate the amount cannot be honestly folded in; skip rather
      // than silently add a foreign figure to a base-currency column.
      if (!rate) continue;
      amount = mulMinorByDecimal(amount, rate);
    }
    grossByDay.set(row.reportDate, (grossByDay.get(row.reportDate) ?? 0n) + amount);
  }

  let missingRateDays = 0;
  const inputs = days.map((date) => {
    const daily = quoteRates.get(date);
    if (!daily) missingRateDays += 1;
    return {
      date,
      gross: grossByDay.get(date) ?? 0n,
      rate: daily?.rate ?? null,
      rateAsOf: daily?.asOfDate ?? null,
    };
  });

  return {
    month,
    sheet: computeSheet(inputs, config),
    convertedCurrencies: foreign,
    missingRateDays,
  };
}
