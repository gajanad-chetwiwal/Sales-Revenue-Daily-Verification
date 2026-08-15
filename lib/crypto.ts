import 'server-only';

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM encryption for store API tokens at rest.
 *
 * Tokens are entered per store in the admin UI and stored encrypted in the
 * `stores` table. They are decrypted server-side only, at sync time. The
 * `server-only` import above makes it a build error for any client component
 * to pull this module — and therefore `TOKEN_ENCRYPTION_KEY` — into a browser
 * bundle.
 *
 * Payload format: `v1.<base64(iv ‖ authTag ‖ ciphertext)>`
 */

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const VERSION = 'v1';

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

function decodeKey(raw: string): Buffer {
  const trimmed = raw.trim();
  if (!BASE64_PATTERN.test(trimmed)) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be base64-encoded');
  }
  const key = Buffer.from(trimmed, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}`,
    );
  }
  return key;
}

function getKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('TOKEN_ENCRYPTION_KEY is not set');
  }
  return decodeKey(raw);
}

/** Encrypt a plaintext API token for storage in `stores.token_encrypted`. */
export function encryptToken(plaintext: string): string {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('Cannot encrypt an empty token');
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${VERSION}.${Buffer.concat([iv, authTag, ciphertext]).toString('base64')}`;
}

/**
 * Decrypt a stored token. Throws if the payload was tampered with, truncated,
 * or encrypted under a different key — GCM authenticates as well as encrypts.
 */
export function decryptToken(payload: string): string {
  if (typeof payload !== 'string' || payload.length === 0) {
    throw new Error('Cannot decrypt an empty payload');
  }
  const separator = payload.indexOf('.');
  if (separator === -1) {
    throw new Error('Malformed encrypted token: missing version prefix');
  }
  const version = payload.slice(0, separator);
  if (version !== VERSION) {
    throw new Error(`Unsupported encrypted token version "${version}"`);
  }

  const body = Buffer.from(payload.slice(separator + 1), 'base64');
  if (body.length <= IV_BYTES + TAG_BYTES) {
    throw new Error('Malformed encrypted token: payload too short');
  }

  const iv = body.subarray(0, IV_BYTES);
  const authTag = body.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = body.subarray(IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/**
 * What the admin UI is allowed to show: the last 4 characters only.
 * Safe to send to the client.
 */
export function maskToken(token: string): string {
  if (typeof token !== 'string' || token.length === 0) return '••••';
  if (token.length <= 4) return '•'.repeat(4);
  return `••••${token.slice(-4)}`;
}

/** Convenience for provisioning: prints a fresh TOKEN_ENCRYPTION_KEY. */
export function generateEncryptionKey(): string {
  return randomBytes(KEY_BYTES).toString('base64');
}
