import { randomBytes } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';

/** Flip every bit of one byte in place — Buffer index access is not narrowed
 * by `noUncheckedIndexedAccess`, so go through read/write. */
function flipByte(buffer: Buffer, index: number): void {
  buffer.writeUInt8(buffer.readUInt8(index) ^ 0xff, index);
}

const KEY_A = randomBytes(32).toString('base64');
const KEY_B = randomBytes(32).toString('base64');

async function loadCrypto() {
  // Re-import per test so each one picks up the env var set just above it.
  return import('@/lib/crypto');
}

beforeEach(() => {
  process.env.TOKEN_ENCRYPTION_KEY = KEY_A;
});

describe('encryptToken / decryptToken', () => {
  it('round-trips a token', async () => {
    const { encryptToken, decryptToken } = await loadCrypto();
    // Deliberately not shaped like a real platform token — a realistic-looking
    // fixture trips GitHub push protection.
    const token = 'fake-store-api-token-0123456789abcdef';
    expect(decryptToken(encryptToken(token))).toBe(token);
  });

  it('round-trips unicode and long values', async () => {
    const { encryptToken, decryptToken } = await loadCrypto();
    const token = `fake-${'x'.repeat(512)}—✓`;
    expect(decryptToken(encryptToken(token))).toBe(token);
  });

  it('produces a versioned payload that does not contain the plaintext', async () => {
    const { encryptToken } = await loadCrypto();
    const payload = encryptToken('super-secret-token');
    expect(payload.startsWith('v1.')).toBe(true);
    expect(payload).not.toContain('super-secret-token');
  });

  it('uses a fresh IV so the same input never yields the same ciphertext', async () => {
    const { encryptToken } = await loadCrypto();
    expect(encryptToken('same-token')).not.toBe(encryptToken('same-token'));
  });

  it('rejects a payload encrypted under a different key', async () => {
    const { encryptToken, decryptToken } = await loadCrypto();
    const payload = encryptToken('token-under-key-a');
    process.env.TOKEN_ENCRYPTION_KEY = KEY_B;
    expect(() => decryptToken(payload)).toThrow();
  });

  it('detects tampering with the ciphertext', async () => {
    const { encryptToken, decryptToken } = await loadCrypto();
    const payload = encryptToken('token-to-tamper-with');
    const body = Buffer.from(payload.slice(3), 'base64');
    flipByte(body, body.length - 1);
    expect(() => decryptToken(`v1.${body.toString('base64')}`)).toThrow();
  });

  it('detects tampering with the auth tag', async () => {
    const { encryptToken, decryptToken } = await loadCrypto();
    const payload = encryptToken('token-to-tamper-with');
    const body = Buffer.from(payload.slice(3), 'base64');
    flipByte(body, 13);
    expect(() => decryptToken(`v1.${body.toString('base64')}`)).toThrow();
  });

  it('rejects malformed payloads', async () => {
    const { decryptToken } = await loadCrypto();
    expect(() => decryptToken('')).toThrow();
    expect(() => decryptToken('no-version-prefix')).toThrow(/version/i);
    expect(() => decryptToken('v2.abcdef')).toThrow(/version/i);
    expect(() => decryptToken('v1.c2hvcnQ=')).toThrow(/too short/i);
  });

  it('refuses to encrypt an empty token', async () => {
    const { encryptToken } = await loadCrypto();
    expect(() => encryptToken('')).toThrow();
  });
});

describe('key validation', () => {
  it('throws when TOKEN_ENCRYPTION_KEY is missing', async () => {
    const { encryptToken } = await loadCrypto();
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(() => encryptToken('token')).toThrow(/not set/i);
  });

  it('throws when the key is the wrong length', async () => {
    const { encryptToken } = await loadCrypto();
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(16).toString('base64');
    expect(() => encryptToken('token')).toThrow(/32 bytes/i);
  });

  it('throws when the key is not base64', async () => {
    const { encryptToken } = await loadCrypto();
    process.env.TOKEN_ENCRYPTION_KEY = 'not base64!!';
    expect(() => encryptToken('token')).toThrow(/base64/i);
  });

  it('generates keys of the right shape', async () => {
    const { generateEncryptionKey } = await loadCrypto();
    const key = generateEncryptionKey();
    expect(Buffer.from(key, 'base64')).toHaveLength(32);
  });
});

describe('maskToken', () => {
  it('reveals only the last four characters', async () => {
    const { maskToken } = await loadCrypto();
    expect(maskToken('fake-store-api-token-abcdef1234')).toBe('••••1234');
  });

  it('reveals nothing for short or empty tokens', async () => {
    const { maskToken } = await loadCrypto();
    expect(maskToken('abcd')).toBe('••••');
    expect(maskToken('')).toBe('••••');
  });
});
