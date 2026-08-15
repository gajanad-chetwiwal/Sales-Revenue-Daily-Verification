/**
 * Stateless session cookie for the single admin login.
 *
 * The cookie value is `v1.<expiresAtMs>.<hmacSha256Hex>`, signed with
 * DASHBOARD_PASSWORD. Nothing is stored server-side — there is one user, so
 * there is no session table and no user table.
 *
 * This module deliberately uses Web Crypto only (no `node:crypto`) so the same
 * code runs in Next's Edge middleware and in Node route handlers.
 */

export const SESSION_COOKIE = 'asd_session';

/** 30 days. */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000;
const VERSION = 'v1';

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
}

async function sign(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return toHex(new Uint8Array(signature));
}

/** Compare two equal-purpose strings without leaking position via timing. */
function timingSafeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export interface SessionToken {
  value: string;
  expiresAt: Date;
}

export async function createSessionToken(
  secret: string,
  now: number = Date.now(),
): Promise<SessionToken> {
  const expiresAt = now + SESSION_TTL_MS;
  const signature = await sign(secret, `${VERSION}:${expiresAt}`);
  return {
    value: `${VERSION}.${expiresAt}.${signature}`,
    expiresAt: new Date(expiresAt),
  };
}

export async function verifySessionToken(
  token: string | undefined,
  secret: string,
  now: number = Date.now(),
): Promise<boolean> {
  if (!token || !secret) return false;

  const parts = token.split('.');
  if (parts.length !== 3) return false;

  const [version, expiresAtRaw, signature] = parts as [string, string, string];
  if (version !== VERSION) return false;

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return false;

  const expected = await sign(secret, `${VERSION}:${expiresAt}`);
  return timingSafeEquals(signature, expected);
}
