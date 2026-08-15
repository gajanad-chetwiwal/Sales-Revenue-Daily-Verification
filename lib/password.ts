import 'server-only';

import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Constant-time string comparison for secrets of unequal length.
 * Hashing first makes the comparison length-independent, so a wrong guess
 * leaks neither the password's length nor its matching prefix.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  const hashA = createHash('sha256').update(a, 'utf8').digest();
  const hashB = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(hashA, hashB);
}
