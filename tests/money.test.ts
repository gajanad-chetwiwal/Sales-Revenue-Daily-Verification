import { describe, expect, it } from 'vitest';

import {
  currencyExponent,
  formatMinor,
  formatMinorGrouped,
  fromMinorUnits,
  parseDecimalToMinor,
  sumMinor,
} from '@/lib/money';

describe('parseDecimalToMinor', () => {
  it('parses ordinary two-decimal amounts exactly', () => {
    expect(parseDecimalToMinor('12.34', 'USD')).toBe(1234n);
    expect(parseDecimalToMinor('0.01', 'USD')).toBe(1n);
    expect(parseDecimalToMinor('1000', 'USD')).toBe(100000n);
    expect(parseDecimalToMinor('0', 'USD')).toBe(0n);
  });

  it('avoids the float trap that makes naive money code drift', () => {
    // 0.1 + 0.2 === 0.30000000000000004 in IEEE-754.
    const total = parseDecimalToMinor('0.10', 'USD') + parseDecimalToMinor('0.20', 'USD');
    expect(total).toBe(30n);
    expect(formatMinor(total, 'USD')).toBe('0.30');
  });

  it('stays exact over a large number of additions', () => {
    const cents = Array.from({ length: 10_000 }, () => parseDecimalToMinor('0.07', 'USD'));
    expect(sumMinor(cents)).toBe(70_000n);
  });

  it('handles zero-decimal currencies', () => {
    expect(currencyExponent('JPY')).toBe(0);
    expect(parseDecimalToMinor('1234', 'JPY')).toBe(1234n);
    expect(formatMinor(1234n, 'JPY')).toBe('1234');
  });

  it('handles three-decimal currencies', () => {
    expect(currencyExponent('KWD')).toBe(3);
    expect(parseDecimalToMinor('12.345', 'KWD')).toBe(12345n);
    expect(formatMinor(12345n, 'KWD')).toBe('12.345');
  });

  it('rounds half-up when given more precision than the currency has', () => {
    expect(parseDecimalToMinor('1.005', 'USD')).toBe(101n);
    expect(parseDecimalToMinor('1.004', 'USD')).toBe(100n);
  });

  it('handles negatives (refunds)', () => {
    expect(parseDecimalToMinor('-12.34', 'USD')).toBe(-1234n);
    expect(formatMinor(-1234n, 'USD')).toBe('-12.34');
  });

  it('treats blank input as zero and rejects junk', () => {
    expect(parseDecimalToMinor('', 'USD')).toBe(0n);
    expect(() => parseDecimalToMinor('1,234.00', 'USD')).toThrow(TypeError);
    expect(() => parseDecimalToMinor('abc', 'USD')).toThrow(TypeError);
  });
});

describe('fromMinorUnits', () => {
  it('passes through Square-style integer cents', () => {
    expect(fromMinorUnits(1234)).toBe(1234n);
    expect(fromMinorUnits(null)).toBe(0n);
    expect(fromMinorUnits(undefined)).toBe(0n);
  });
});

describe('formatMinorGrouped', () => {
  it('groups thousands', () => {
    expect(formatMinorGrouped(123456789n, 'USD')).toBe('1,234,567.89');
    expect(formatMinorGrouped(100n, 'USD')).toBe('1.00');
    expect(formatMinorGrouped(-123456n, 'USD')).toBe('-1,234.56');
    expect(formatMinorGrouped(1234567n, 'JPY')).toBe('1,234,567');
  });
});
