import { describe, expect, it } from 'vitest';

import { formatMinor } from '@/lib/money';
import { computeSheet, DEFAULT_SHEET_CONFIG, formatBps, type SheetConfig } from '@/lib/sheet';

/**
 * Reproduces the real July 2026 sheet supplied by the business.
 *
 * That sheet used a single flat rate (Google Sheets' GOOGLEFINANCE without a
 * date returns today's rate for every row), so these fixtures use the same flat
 * 95.4505 in order to compare like with like.
 */
const RATE = '95.4505';

const CONFIG: SheetConfig = {
  ...DEFAULT_SHEET_CONFIG,
  teamCostPercent: '30',
  transactionCostPercent: '2.5',
  extraProfitPercent: '0.4',
  partners: ['Jack', 'Daniel'],
};

/** Gross revenue per day, in dollars, exactly as published. */
const JULY_GROSS: Record<number, number> = {
  1: 8436, 2: 9646, 3: 3693, 4: 1884, 5: 0, 6: 7623, 7: 2280, 8: 6785,
  9: 7583, 10: 7197, 11: 0, 12: 0, 13: 0, 14: 0, 15: 3238, 16: 5116,
  17: 0, 18: 0, 19: 0, 20: 6991, 21: 9555, 22: 5749, 23: 6191, 24: 9700,
  25: 0, 26: 0, 27: 0, 28: 7287, 29: 4059, 30: 5872, 31: 8816,
};

const inputs = Object.entries(JULY_GROSS).map(([day, dollars]) => ({
  date: `2026-07-${String(day).padStart(2, '0')}`,
  gross: BigInt(dollars) * 100n,
  rate: RATE,
  rateAsOf: `2026-07-${String(day).padStart(2, '0')}`,
}));

const { rows, totals } = computeSheet(inputs, CONFIG);
const row = (day: number) => rows[day - 1]!;
const usd = (minor: bigint) => formatMinor(minor, 'USD');

describe('July 2026 sheet — per-row reproduction', () => {
  it('matches 1 July across every column', () => {
    const r = row(1);
    expect(r.weekday).toBe('Wednesday');
    expect(usd(r.gross)).toBe('8436.00');
    expect(usd(r.teamCost)).toBe('2530.80');
    expect(usd(r.revenue)).toBe('5905.20');
    expect(usd(r.transactionCost)).toBe('210.90');
    expect(usd(r.totalExpense)).toBe('210.90');
    expect(usd(r.partnerEarnings[0]!)).toBe('2847.15');
    expect(usd(r.partnerEarnings[1]!)).toBe('2847.15');
    expect(formatBps(r.profitBps)).toBe('33.75%');
    expect(formatBps(r.expenseBps)).toBe('2.50%');
    expect(usd(r.inr!)).toBe('271761.89');
    expect(usd(r.extraProfit)).toBe('33.74');
    expect(usd(r.extraProfitInr!)).toBe('3220.88');
  });

  it.each([
    [2, '9646.00', '2893.80', '6752.20', '241.15', '3255.53', '310741.49', '38.58', '3682.86'],
    [3, '3693.00', '1107.90', '2585.10', '92.33', '1246.39', '118968.31', '14.77', '1409.99'],
    [4, '1884.00', '565.20', '1318.80', '47.10', '635.85', '60692.20', '7.54', '719.31'],
    [6, '7623.00', '2286.90', '5336.10', '190.58', '2572.76', '245571.47', '30.49', '2910.48'],
    [7, '2280.00', '684.00', '1596.00', '57.00', '769.50', '73449.16', '9.12', '870.51'],
    [21, '9555.00', '2866.50', '6688.50', '238.88', '3224.81', '307809.97', '38.22', '3648.12'],
    [31, '8816.00', '2644.80', '6171.20', '220.40', '2975.40', '284003.42', '35.26', '3365.97'],
  ])(
    'matches %i July',
    (day, gross, teamCost, revenue, txn, jack, inr, extra, extraInr) => {
      const r = row(day as number);
      expect(usd(r.gross)).toBe(gross);
      expect(usd(r.teamCost)).toBe(teamCost);
      expect(usd(r.revenue)).toBe(revenue);
      expect(usd(r.transactionCost)).toBe(txn);
      expect(usd(r.partnerEarnings[0]!)).toBe(jack);
      expect(usd(r.inr!)).toBe(inr);
      expect(usd(r.extraProfit)).toBe(extra);
      expect(usd(r.extraProfitInr!)).toBe(extraInr);
    },
  );

  it('shows an em dash instead of #DIV/0! on zero-revenue days', () => {
    const r = row(5);
    expect(usd(r.gross)).toBe('0.00');
    expect(r.profitBps).toBeNull();
    expect(r.expenseBps).toBeNull();
    expect(formatBps(r.profitBps)).toBe('—');
    expect(formatBps(r.expenseBps)).toBe('—');
  });

  it('gives equal partners equal shares, within a cent of the exact split', () => {
    for (const r of rows) {
      const [first, second] = r.partnerEarnings as [bigint, bigint];
      expect(first).toBe(second);
      const summed = first + second;
      const exact = r.revenue - r.totalExpense;
      const drift = summed > exact ? summed - exact : exact - summed;
      expect(drift).toBeLessThanOrEqual(1n);
    }
  });
});

describe('July 2026 sheet — totals', () => {
  it('matches the published monthly totals', () => {
    expect(usd(totals.gross)).toBe('127701.00');
    expect(usd(totals.teamCost)).toBe('38310.30');
    expect(usd(totals.revenue)).toBe('89390.70');
    expect(usd(totals.transactionCost)).toBe('3192.53');
    expect(usd(totals.partnerEarnings[0]!)).toBe('43099.09');
    expect(usd(totals.partnerEarnings[1]!)).toBe('43099.09');
  });

  it('computes the totals-row percentages correctly', () => {
    // The source sheet showed 2.50% and #DIV/0! here — its two percentage
    // formulas were shifted a column on the totals row only.
    expect(formatBps(totals.profitBps)).toBe('33.75%');
    expect(formatBps(totals.expenseBps)).toBe('2.50%');
  });

  it('reports extra profit without the removed manual AE column', () => {
    // Published total was $1,110.80 because it included a manual AE entry of
    // $600 on 26 July. With AE removed the accrual alone is 0.4% of gross.
    expect(usd(totals.extraProfit)).toBe('510.80');
  });

  it('matches the published monthly INR total to within a paisa', () => {
    // Published figure was Rs.4,113,829.45; summing the daily column at a flat
    // 95.4505 gives .46. The gap is one paisa in 4.1 million (0.0000002%) and
    // comes from the source rate not being exactly 95.4505 to the last digit —
    // an exact-equality assertion here would be asserting a coincidence.
    const published = 411382945n;
    const drift = totals.inr > published ? totals.inr - published : published - totals.inr;
    expect(drift).toBeLessThanOrEqual(2n);
  });

  it('grand total is INR plus extra-profit INR', () => {
    expect(totals.grandTotalInr).toBe(totals.inr + totals.extraProfitInr);
  });
});
