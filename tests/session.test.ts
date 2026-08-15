import { describe, expect, it } from 'vitest';

import { createSessionToken, verifySessionToken } from '@/lib/session';

const SECRET = 'correct-horse-battery-staple';
const NOW = Date.parse('2026-08-15T00:30:00.000Z');

describe('session tokens', () => {
  it('verifies a freshly issued token', async () => {
    const { value } = await createSessionToken(SECRET, NOW);
    expect(await verifySessionToken(value, SECRET, NOW + 1000)).toBe(true);
  });

  it('reports an expiry 30 days out', async () => {
    const { expiresAt } = await createSessionToken(SECRET, NOW);
    expect(expiresAt.getTime() - NOW).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('rejects a token signed with a different password', async () => {
    const { value } = await createSessionToken(SECRET, NOW);
    expect(await verifySessionToken(value, 'a-different-password', NOW + 1000)).toBe(false);
  });

  it('rejects an expired token', async () => {
    const { value, expiresAt } = await createSessionToken(SECRET, NOW);
    expect(await verifySessionToken(value, SECRET, expiresAt.getTime() + 1)).toBe(false);
  });

  it('rejects a tampered expiry', async () => {
    const { value } = await createSessionToken(SECRET, NOW);
    const [version, expiresAt, signature] = value.split('.');
    const extended = `${version}.${Number(expiresAt) + 86_400_000}.${signature}`;
    expect(await verifySessionToken(extended, SECRET, NOW + 1000)).toBe(false);
  });

  it('rejects a tampered signature', async () => {
    const { value } = await createSessionToken(SECRET, NOW);
    expect(await verifySessionToken(`${value.slice(0, -1)}0`, SECRET, NOW + 1000)).toBe(false);
  });

  it('rejects missing, malformed and wrong-version tokens', async () => {
    expect(await verifySessionToken(undefined, SECRET, NOW)).toBe(false);
    expect(await verifySessionToken('', SECRET, NOW)).toBe(false);
    expect(await verifySessionToken('garbage', SECRET, NOW)).toBe(false);
    expect(await verifySessionToken('v2.123.abc', SECRET, NOW)).toBe(false);
    expect(await verifySessionToken('v1.notanumber.abc', SECRET, NOW)).toBe(false);
  });

  it('rejects everything when no password is configured', async () => {
    const { value } = await createSessionToken(SECRET, NOW);
    expect(await verifySessionToken(value, '', NOW + 1000)).toBe(false);
  });
});
