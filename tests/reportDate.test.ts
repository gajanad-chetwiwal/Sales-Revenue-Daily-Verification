import { describe, expect, it } from 'vitest';

import {
  addReportDays,
  formatIstTime,
  getCurrentReportDate,
  getReportDate,
  isValidReportDate,
  nextReportDate,
  previousReportDate,
  reportDayEnd,
  reportDayRange,
  reportDayStart,
} from '@/lib/reportDate';

/**
 * IST is UTC+05:30, so 06:00:00 IST == 00:30:00Z the same calendar day.
 * The boundary cases below are expressed in UTC to stay independent of the
 * machine's local timezone.
 */
describe('getReportDate — the 6AM IST boundary', () => {
  it('assigns 05:59:59 IST to the previous calendar date', () => {
    expect(getReportDate(new Date('2026-08-15T00:29:59.000Z'))).toBe('2026-08-14');
  });

  it('assigns 06:00:00 IST to that same calendar date', () => {
    expect(getReportDate(new Date('2026-08-15T00:30:00.000Z'))).toBe('2026-08-15');
  });

  it('treats the final millisecond before 06:00 IST as the previous day', () => {
    expect(getReportDate(new Date('2026-08-15T00:29:59.999Z'))).toBe('2026-08-14');
  });

  it('matches the worked examples from the spec', () => {
    // 02:30 IST on Aug 15 -> report_date 2026-08-14
    expect(getReportDate(new Date('2026-08-14T21:00:00.000Z'))).toBe('2026-08-14');
    // 06:01 IST on Aug 15 -> report_date 2026-08-15
    expect(getReportDate(new Date('2026-08-15T00:31:00.000Z'))).toBe('2026-08-15');
  });

  it('keeps late-evening IST orders on the same reporting day', () => {
    // 23:59:59 IST on Aug 15 == 18:29:59Z
    expect(getReportDate(new Date('2026-08-15T18:29:59.000Z'))).toBe('2026-08-15');
  });

  it('handles the midnight IST rollover (still the previous reporting day)', () => {
    // 00:00:00 IST on Aug 16 == 18:30:00Z on Aug 15
    expect(getReportDate(new Date('2026-08-15T18:30:00.000Z'))).toBe('2026-08-15');
  });

  it('rolls the month correctly', () => {
    // 05:00 IST on Sep 1 -> 2026-08-31
    expect(getReportDate(new Date('2026-08-31T23:30:00.000Z'))).toBe('2026-08-31');
    // 06:00 IST on Sep 1 -> 2026-09-01
    expect(getReportDate(new Date('2026-09-01T00:30:00.000Z'))).toBe('2026-09-01');
  });

  it('rolls the year correctly', () => {
    // 03:00 IST on Jan 1 2026 -> 2025-12-31
    expect(getReportDate(new Date('2025-12-31T21:30:00.000Z'))).toBe('2025-12-31');
    // 06:00 IST on Jan 1 2026 -> 2026-01-01
    expect(getReportDate(new Date('2025-12-31T00:30:00.000Z'))).toBe('2025-12-31');
    expect(getReportDate(new Date('2026-01-01T00:30:00.000Z'))).toBe('2026-01-01');
  });

  it('handles a leap day', () => {
    expect(getReportDate(new Date('2028-02-29T00:30:00.000Z'))).toBe('2028-02-29');
    expect(getReportDate(new Date('2028-02-29T00:29:59.000Z'))).toBe('2028-02-28');
  });

  it('rejects invalid input', () => {
    expect(() => getReportDate(new Date('nonsense'))).toThrow(TypeError);
    expect(() => getReportDate('2026-08-15' as unknown as Date)).toThrow(TypeError);
  });
});

describe('getCurrentReportDate', () => {
  it('returns yesterday before 06:00 IST', () => {
    expect(getCurrentReportDate(new Date('2026-08-15T00:00:00.000Z'))).toBe('2026-08-14');
  });

  it('returns today from 06:00 IST onward', () => {
    expect(getCurrentReportDate(new Date('2026-08-15T01:00:00.000Z'))).toBe('2026-08-15');
  });
});

describe('reportDayStart / reportDayEnd', () => {
  it('starts at 06:00 IST (00:30Z) on the reporting date', () => {
    expect(reportDayStart('2026-08-15').toISOString()).toBe('2026-08-15T00:30:00.000Z');
  });

  it('ends exclusively at 06:00 IST the next day', () => {
    expect(reportDayEnd('2026-08-15').toISOString()).toBe('2026-08-16T00:30:00.000Z');
  });

  it('covers exactly 24 hours', () => {
    const { start, endExclusive } = reportDayRange('2026-08-15');
    expect(endExclusive.getTime() - start.getTime()).toBe(86_400_000);
  });

  it('round-trips through getReportDate at both edges', () => {
    const reportDate = '2026-08-15';
    const { start, endExclusive } = reportDayRange(reportDate);
    expect(getReportDate(start)).toBe(reportDate);
    expect(getReportDate(new Date(endExclusive.getTime() - 1))).toBe(reportDate);
    expect(getReportDate(endExclusive)).toBe('2026-08-16');
  });

  it('rejects malformed dates', () => {
    expect(() => reportDayStart('15-08-2026')).toThrow(TypeError);
    expect(() => reportDayStart('2026-02-30')).toThrow(RangeError);
  });
});

describe('date navigation helpers', () => {
  it('steps backwards and forwards', () => {
    expect(previousReportDate('2026-08-15')).toBe('2026-08-14');
    expect(nextReportDate('2026-08-15')).toBe('2026-08-16');
  });

  it('crosses month and year boundaries', () => {
    expect(previousReportDate('2026-09-01')).toBe('2026-08-31');
    expect(nextReportDate('2026-12-31')).toBe('2027-01-01');
    expect(addReportDays('2026-08-15', -30)).toBe('2026-07-16');
  });
});

describe('isValidReportDate', () => {
  it('accepts real dates only', () => {
    expect(isValidReportDate('2026-08-15')).toBe(true);
    expect(isValidReportDate('2026-13-01')).toBe(false);
    expect(isValidReportDate('2026-02-30')).toBe(false);
    expect(isValidReportDate('not-a-date')).toBe(false);
    expect(isValidReportDate(20260815)).toBe(false);
  });
});

describe('formatIstTime', () => {
  it('renders the IST wall clock regardless of server timezone', () => {
    expect(formatIstTime(new Date('2026-08-15T00:30:00.000Z'))).toBe('06:00:00');
    expect(formatIstTime(new Date('2026-08-15T00:29:59.000Z'))).toBe('05:59:59');
  });
});
