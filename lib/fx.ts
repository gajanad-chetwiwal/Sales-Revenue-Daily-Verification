import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';

import { getDb } from '@/db';
import { fxRates } from '@/db/schema';

import { addReportDays, type ReportDate } from './reportDate';

/**
 * Daily FX rates from the ECB via api.frankfurter.dev — free, keyless, and
 * historical.
 *
 * Two properties matter for a verification tool:
 *
 *  - **Rates are stored per date, once.** Google Sheets' GOOGLEFINANCE without
 *    a date argument returns *today's* rate for every row, so a sheet of last
 *    month's figures silently re-values itself every time it recalculates.
 *    Storing the rate against the date freezes history.
 *  - **Closed markets are carried forward, not invented.** The ECB publishes on
 *    business days only, so weekends and holidays reuse the last published rate
 *    and record which date it came from.
 */

export const FX_SOURCE = 'ecb.frankfurter';
const ENDPOINT = 'https://api.frankfurter.dev/v1';

export interface DailyRate {
  rateDate: ReportDate;
  rate: string;
  /** Date the rate was actually published; differs on weekends/holidays. */
  asOfDate: ReportDate;
  carriedForward: boolean;
}

interface FrankfurterRange {
  start_date?: string;
  end_date?: string;
  rates?: Record<string, Record<string, number>>;
}

function daysBetween(from: ReportDate, to: ReportDate): ReportDate[] {
  const out: ReportDate[] = [];
  for (let d = from; d <= to; d = addReportDays(d, 1)) out.push(d);
  return out;
}

/** Fetch published rates for a window. Only business days come back. */
async function fetchPublished(
  base: string,
  quote: string,
  from: ReportDate,
  to: ReportDate,
): Promise<Map<ReportDate, number>> {
  const url = `${ENDPOINT}/${from}..${to}?base=${base}&symbols=${quote}`;
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`FX request failed (${response.status}) for ${base}/${quote} ${from}..${to}`);
  }
  const payload = (await response.json()) as FrankfurterRange;
  const out = new Map<ReportDate, number>();
  for (const [day, rates] of Object.entries(payload.rates ?? {})) {
    const value = rates[quote];
    if (typeof value === 'number') out.set(day, value);
  }
  return out;
}

/** The most recent published rate at or before `date`, for carry-forward. */
async function fetchLatestOnOrBefore(
  base: string,
  quote: string,
  date: ReportDate,
): Promise<{ rate: number; asOf: ReportDate } | null> {
  const response = await fetch(`${ENDPOINT}/${date}?base=${base}&symbols=${quote}`, {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as { date?: string; rates?: Record<string, number> };
  const value = payload.rates?.[quote];
  if (typeof value !== 'number' || !payload.date) return null;
  return { rate: value, asOf: payload.date };
}

/**
 * Ensure every date in the window has a stored rate, fetching only what is
 * missing. Returns the full set, oldest first.
 */
export async function ensureRates(
  from: ReportDate,
  to: ReportDate,
  base = 'USD',
  quote = 'INR',
): Promise<Map<ReportDate, DailyRate>> {
  const db = getDb();

  const existing = await db
    .select()
    .from(fxRates)
    .where(
      and(
        eq(fxRates.base, base),
        eq(fxRates.quote, quote),
        gte(fxRates.rateDate, from),
        lte(fxRates.rateDate, to),
      ),
    )
    .orderBy(asc(fxRates.rateDate));

  const stored = new Map<ReportDate, DailyRate>(
    existing.map((row) => [
      row.rateDate,
      {
        rateDate: row.rateDate,
        rate: row.rate,
        asOfDate: row.asOfDate,
        carriedForward: row.asOfDate !== row.rateDate,
      },
    ]),
  );

  const wanted = daysBetween(from, to);
  const missing = wanted.filter((day) => !stored.has(day));
  if (missing.length === 0) return stored;

  const published = await fetchPublished(base, quote, from, to);

  // Seed carry-forward with the last published rate at or before the window,
  // so a window that opens on a weekend still resolves.
  let lastRate: number | null = null;
  let lastAsOf: ReportDate | null = null;
  const seed = await fetchLatestOnOrBefore(base, quote, from);
  if (seed) {
    lastRate = seed.rate;
    lastAsOf = seed.asOf;
  }

  const inserts: {
    rateDate: string;
    base: string;
    quote: string;
    rate: string;
    asOfDate: string;
    source: string;
  }[] = [];

  for (const day of wanted) {
    const todays = published.get(day);
    if (todays !== undefined) {
      lastRate = todays;
      lastAsOf = day;
    }
    if (stored.has(day)) continue;
    if (lastRate === null || lastAsOf === null) continue; // nothing to carry yet

    const record: DailyRate = {
      rateDate: day,
      rate: lastRate.toFixed(8),
      asOfDate: lastAsOf,
      carriedForward: lastAsOf !== day,
    };
    stored.set(day, record);
    inserts.push({
      rateDate: day,
      base,
      quote,
      rate: record.rate,
      asOfDate: record.asOfDate,
      source: FX_SOURCE,
    });
  }

  if (inserts.length > 0) {
    // Today's rate may still be provisional (published late in the day), so
    // refresh on conflict rather than ignoring.
    await db
      .insert(fxRates)
      .values(inserts)
      .onConflictDoUpdate({
        target: [fxRates.rateDate, fxRates.base, fxRates.quote],
        set: {
          rate: sql`excluded.rate`,
          asOfDate: sql`excluded.as_of_date`,
          source: sql`excluded.source`,
          fetchedAt: sql`excluded.fetched_at`,
        },
      });
  }

  return stored;
}
