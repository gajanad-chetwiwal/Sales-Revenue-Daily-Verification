/**
 * The 6AM IST reporting-day rule.
 *
 * A "sales day" runs from 06:00:00 IST to 05:59:59 IST the following calendar
 * day. IST is Asia/Kolkata, a fixed UTC+05:30 with no DST, so all of this is
 * plain fixed-offset arithmetic — no timezone database lookups needed, and no
 * dependence on the server's local timezone.
 *
 * Every order gets a `report_date` at sync time via `getReportDate()`. All
 * daily grouping, totals and reports key off that column, never off a UTC date
 * or a store-local date.
 */

/** Asia/Kolkata is UTC+05:30 year-round. */
export const IST_OFFSET_MINUTES = 330;

/** The hour (IST) at which a new reporting day begins. */
export const REPORT_DAY_START_HOUR = 6;

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const IST_OFFSET_MS = IST_OFFSET_MINUTES * MINUTE_MS;
const DAY_START_MS = REPORT_DAY_START_HOUR * HOUR_MS;

/** A reporting day, formatted `YYYY-MM-DD`. */
export type ReportDate = string;

const REPORT_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function assertValidDate(value: Date, label: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError(`${label} must be a valid Date`);
  }
}

/**
 * Map an instant to the reporting day it belongs to.
 *
 * Shifting the instant by +05:30 puts it in IST civil time; shifting it a
 * further -6h moves the 06:00 IST cutoff onto midnight, so the UTC calendar
 * date of the result *is* the reporting date.
 *
 * @example
 * getReportDate(new Date('2026-08-15T00:29:59Z')) // 05:59:59 IST -> '2026-08-14'
 * getReportDate(new Date('2026-08-15T00:30:00Z')) // 06:00:00 IST -> '2026-08-15'
 */
export function getReportDate(createdAt: Date): ReportDate {
  assertValidDate(createdAt, 'createdAt');
  const shifted = new Date(createdAt.getTime() + IST_OFFSET_MS - DAY_START_MS);
  return shifted.toISOString().slice(0, 10);
}

/**
 * The reporting day currently in progress. Before 06:00 IST this is still
 * yesterday's calendar date — which is exactly what the dashboard should
 * default to.
 */
export function getCurrentReportDate(now: Date = new Date()): ReportDate {
  return getReportDate(now);
}

interface DateParts {
  year: number;
  month: number;
  day: number;
}

function parseReportDate(reportDate: ReportDate): DateParts {
  if (typeof reportDate !== 'string' || !REPORT_DATE_PATTERN.test(reportDate)) {
    throw new TypeError(`Invalid report date "${reportDate}" — expected YYYY-MM-DD`);
  }
  const year = Number(reportDate.slice(0, 4));
  const month = Number(reportDate.slice(5, 7));
  const day = Number(reportDate.slice(8, 10));
  const roundTrip = new Date(Date.UTC(year, month - 1, day));
  if (roundTrip.toISOString().slice(0, 10) !== reportDate) {
    throw new RangeError(`Invalid report date "${reportDate}" — not a real calendar date`);
  }
  return { year, month, day };
}

/** True if the string is a well-formed, real `YYYY-MM-DD` date. */
export function isValidReportDate(value: unknown): value is ReportDate {
  if (typeof value !== 'string') return false;
  try {
    parseReportDate(value);
    return true;
  } catch {
    return false;
  }
}

/** The instant a reporting day begins: 06:00:00 IST on that calendar date. */
export function reportDayStart(reportDate: ReportDate): Date {
  const { year, month, day } = parseReportDate(reportDate);
  return new Date(Date.UTC(year, month - 1, day) + DAY_START_MS - IST_OFFSET_MS);
}

/** The instant a reporting day ends, exclusive: 06:00:00 IST the next day. */
export function reportDayEnd(reportDate: ReportDate): Date {
  return new Date(reportDayStart(reportDate).getTime() + DAY_MS);
}

/** Half-open UTC range `[start, endExclusive)` covering a reporting day. */
export function reportDayRange(reportDate: ReportDate): { start: Date; endExclusive: Date } {
  return { start: reportDayStart(reportDate), endExclusive: reportDayEnd(reportDate) };
}

/** Shift a reporting date by whole days. */
export function addReportDays(reportDate: ReportDate, delta: number): ReportDate {
  if (!Number.isInteger(delta)) {
    throw new TypeError('delta must be an integer number of days');
  }
  const { year, month, day } = parseReportDate(reportDate);
  return new Date(Date.UTC(year, month - 1, day) + delta * DAY_MS).toISOString().slice(0, 10);
}

export function previousReportDate(reportDate: ReportDate): ReportDate {
  return addReportDays(reportDate, -1);
}

export function nextReportDate(reportDate: ReportDate): ReportDate {
  return addReportDays(reportDate, 1);
}

const istTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const istDateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** `HH:MM:SS` in IST — the time column on the report table. */
export function formatIstTime(instant: Date): string {
  assertValidDate(instant, 'instant');
  return istTimeFormatter.format(instant);
}

/** e.g. `15 Aug 2026, 06:01` in IST. */
export function formatIstDateTime(instant: Date): string {
  assertValidDate(instant, 'instant');
  return istDateTimeFormatter.format(instant);
}

const reportDateLabelFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** Human label for a reporting day, e.g. `Sat, 15 Aug 2026`. */
export function formatReportDateLabel(reportDate: ReportDate): string {
  const { year, month, day } = parseReportDate(reportDate);
  return reportDateLabelFormatter.format(new Date(Date.UTC(year, month - 1, day)));
}
