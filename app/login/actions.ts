'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { constantTimeEquals } from '@/lib/password';
import { SESSION_COOKIE, createSessionToken } from '@/lib/session';

/** Only allow same-origin, absolute-path redirects — never `//evil.com`. */
function safeNextPath(raw: string): string {
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
}

export async function loginAction(formData: FormData): Promise<void> {
  const submitted = String(formData.get('password') ?? '');
  const next = safeNextPath(String(formData.get('next') ?? '/'));

  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) {
    throw new Error('Missing required environment variable: DASHBOARD_PASSWORD');
  }

  if (!constantTimeEquals(submitted, password)) {
    const params = new URLSearchParams({ error: '1' });
    if (next !== '/') params.set('next', next);
    redirect(`/login?${params.toString()}`);
  }

  const { value, expiresAt } = await createSessionToken(password);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });

  redirect(next);
}

export async function logoutAction(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  redirect('/login');
}
