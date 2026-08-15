import { divRoundHalfUp, mulMinorByDecimals, percentOf } from './money';
import type { ReportDate } from './reportDate';

/**
 * The monthly P&L sheet.
 *
 * Everything derives from one number per day — Gross Revenue, summed across
 * every store — so the whole sheet is reproducible from the transaction table
 * plus that day's FX rate. Percentages are applied to unrounded values and
 * rounded once at the end, which is what makes the output tie to the cent
 * against a spreadsheet doing the same.
 */

export interface SheetConfig {
  /** Share of gross taken as team cost, e.g. '30'. */
  teamCostPercent: string;
  /** Payment processing assumption, e.g. '2.5'. */
  transactionCostPercent: string;
  /** Extra profit accrual, e.g. '0.4'. */
  extraProfitPercent: string;
  /** Names of the partners splitting the remainder equally. */
  partners: string[];
  /** Currency the sheet is denominated in before conversion. */
  baseCurrency: string;
  /** Currency the INR columns convert to. */
  quoteCurrency: string;
}

export const DEFAULT_SHEET_CONFIG: SheetConfig = {
  teamCostPercent: process.env.SHEET_TEAM_COST_PERCENT ?? '30',
  transactionCostPercent: process.env.SHEET_TRANSACTION_COST_PERCENT ?? '2.5',
  extraProfitPercent: process.env.SHEET_EXTRA_PROFIT_PERCENT ?? '0.4',
  partners: (process.env.SHEET_PARTNERS ?? 'Jack,Daniel').split(',').map((n) => n.trim()),
  baseCurrency: process.env.SHEET_BASE_CURRENCY ?? 'USD',
  quoteCurrency: process.env.SHEET_QUOTE_CURRENCY ?? 'INR',
};

export interface SheetRowInput {
  date: ReportDate;
  gross: bigint;
  /** Decimal string, or null when no rate could be resolved. */
  rate: string | null;
  rateAsOf?: ReportDate | null;
}

export interface SheetRow {
  date: ReportDate;
  weekday: string;
  gross: bigint;
  teamCost: bigint;
  revenue: bigint;
  transactionCost: bigint;
  totalExpense: bigint;
  /** One entry per partner, in config order. */
  partnerEarnings: bigint[];
  /** Basis points (3375 = 33.75%), or null when gross is zero. */
  profitBps: number | null;
  expenseBps: number | null;
  rate: string | null;
  rateAsOf: ReportDate | null;
  rateCarriedForward: boolean;
  /** First partner's earning converted to the quote currency. */
  inr: bigint | null;
  extraProfit: bigint;
  extraProfitInr: bigint | null;
}

const weekdayFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  weekday: 'long',
});

function weekdayOf(date: ReportDate): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return weekdayFormatter.format(new Date(Date.UTC(y, m - 1, d)));
}


/** Percent string -> integer scaled by 1e6, so "2.5" becomes 2_500_000. */
function percentToScaled(percent: string): bigint {
  const trimmed = percent.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new TypeError(`Cannot parse "${percent}" as a percentage`);
  }
  const [whole = '0', fraction = ''] = trimmed.split('.');
  return BigInt(whole + (fraction + '000000').slice(0, 6));
}

/**
 * One partner's share as an exact decimal factor of gross.
 *
 * The sheet displays each partner's earning rounded to cents but converts the
 * *unrounded* figure to INR: 9,646 x 0.3375 = 3,255.5250 becomes Rs.310,741.49,
 * whereas converting the displayed 3,255.53 gives Rs.310,741.97. Deriving the
 * factor straight from gross keeps that precision.
 */
export function partnerShareFactor(config: SheetConfig): string {
  const hundred = 100_000000n;
  const remainder =
    hundred - percentToScaled(config.teamCostPercent) - percentToScaled(config.transactionCostPercent);
  const denominator = hundred * BigInt(Math.max(1, config.partners.length));
  const scaled = (remainder * 10n ** 12n) / denominator;
  const digits = scaled.toString().padStart(13, '0');
  return `${digits.slice(0, digits.length - 12)}.${digits.slice(digits.length - 12)}`;
}

export function computeSheetRow(input: SheetRowInput, config: SheetConfig): SheetRow {
  const { gross } = input;

  const teamCost = percentOf(gross, config.teamCostPercent);
  const revenue = gross - teamCost;
  const transactionCost = percentOf(gross, config.transactionCostPercent);
  // Manual expense columns were removed, so total expense is transaction cost
  // alone. Kept as its own column so added expense lines stay easy to slot in.
  const totalExpense = transactionCost;

  const distributable = revenue - totalExpense;
  const partnerCount = BigInt(Math.max(1, config.partners.length));
  // Equal partners each get the rounded half, mirroring the source sheet. On an
  // odd number of cents that means the shares sum to a cent more than the
  // distributable amount; the alternative — handing the remainder to one
  // partner — would show unequal earnings for an equal split, which reads as a
  // bug to anyone comparing against their own spreadsheet.
  const share = divRoundHalfUp(distributable, partnerCount);
  const partnerEarnings = config.partners.map(() => share);

  const extraProfit = percentOf(gross, config.extraProfitPercent);

  const rate = input.rate;
  const inr = rate ? mulMinorByDecimals(gross, [partnerShareFactor(config), rate]) : null;
  // Converted from the *unrounded* accrual, matching how a spreadsheet chains
  // the two multiplications — rounding to cents first loses paise on this row.
  const extraProfitInr = rate
    ? mulMinorByDecimals(gross, [(Number(config.extraProfitPercent) / 100).toFixed(10), rate])
    : null;

  return {
    date: input.date,
    weekday: weekdayOf(input.date),
    gross,
    teamCost,
    revenue,
    transactionCost,
    totalExpense,
    partnerEarnings,
    // Zero-revenue days have no meaningful ratio — a spreadsheet shows
    // #DIV/0! here; null renders as an em dash instead.
    profitBps:
      gross === 0n ? null : Number(divRoundHalfUp((partnerEarnings[0] ?? 0n) * 10_000n, gross)),
    expenseBps: gross === 0n ? null : Number(divRoundHalfUp(totalExpense * 10_000n, gross)),
    rate: rate ?? null,
    rateAsOf: input.rateAsOf ?? null,
    rateCarriedForward: Boolean(input.rateAsOf && input.rateAsOf !== input.date),
    inr,
    extraProfit,
    extraProfitInr,
  };
}

export interface SheetTotals {
  gross: bigint;
  teamCost: bigint;
  revenue: bigint;
  transactionCost: bigint;
  totalExpense: bigint;
  partnerEarnings: bigint[];
  profitBps: number | null;
  expenseBps: number | null;
  inr: bigint;
  extraProfit: bigint;
  extraProfitInr: bigint;
  /** INR + Extra Profit INR — the sheet's bottom-right figure. */
  grandTotalInr: bigint;
}

export function computeSheet(
  inputs: SheetRowInput[],
  config: SheetConfig = DEFAULT_SHEET_CONFIG,
): { rows: SheetRow[]; totals: SheetTotals } {
  const rows = inputs.map((input) => computeSheetRow(input, config));

  const grossTotal = rows.reduce((acc, row) => acc + row.gross, 0n);

  // The money columns are the formulas applied to the *monthly* gross, not the
  // sum of the daily column. Those differ: summing the rounded daily
  // transaction costs for July gives 3,192.58, while 2.5% of the month's gross
  // is 3,192.53 — and 3,192.53 is what the business's sheet reports.
  const monthly = computeSheetRow(
    { date: inputs[0]?.date ?? '1970-01-01', gross: grossTotal, rate: null },
    config,
  );

  // The INR columns are summed instead, because each day converts at its own
  // rate — there is no single monthly rate to apply.
  const inr = rows.reduce((acc, row) => acc + (row.inr ?? 0n), 0n);
  const extraProfitInr = rows.reduce((acc, row) => acc + (row.extraProfitInr ?? 0n), 0n);

  return {
    rows,
    totals: {
      gross: grossTotal,
      teamCost: monthly.teamCost,
      revenue: monthly.revenue,
      transactionCost: monthly.transactionCost,
      totalExpense: monthly.totalExpense,
      partnerEarnings: monthly.partnerEarnings,
      // Computed from the totals — the source sheet's own totals row had these
      // two formulas shifted a column, showing 2.50% and #DIV/0!.
      profitBps: monthly.profitBps,
      expenseBps: monthly.expenseBps,
      inr,
      extraProfit: monthly.extraProfit,
      extraProfitInr,
      grandTotalInr: inr + extraProfitInr,
    },
  };
}

export function formatBps(bps: number | null): string {
  if (bps === null) return '—';
  return `${(bps / 100).toFixed(2)}%`;
}
