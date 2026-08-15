import Link from 'next/link';
import type { ReactNode } from 'react';

import { logoutAction } from '@/app/login/actions';
import { formatReportDateLabel, getCurrentReportDate } from '@/lib/reportDate';

const NAV_LINKS = [
  { href: '/', label: 'Daily report', key: 'report' },
  { href: '/stores', label: 'Stores', key: 'stores' },
] as const;

export function AppShell({
  children,
  active,
}: {
  children: ReactNode;
  active: 'report' | 'stores';
}) {
  const today = getCurrentReportDate();

  return (
    <div className="min-h-screen">
      <header
        className="sticky top-0 z-20 backdrop-blur"
        style={{
          background: 'color-mix(in srgb, var(--surface) 88%, transparent)',
          borderBottom: '1px solid var(--hairline)',
        }}
      >
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5 sm:px-6">
          <span className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <span
              aria-hidden="true"
              style={{
                width: 8,
                height: 16,
                borderRadius: 3,
                background: 'var(--accent)',
                display: 'inline-block',
              }}
            />
            Daily Sales Verification
          </span>

          <nav className="flex items-center gap-1 text-sm">
            {NAV_LINKS.map((link) => {
              const isActive = link.key === active;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={isActive ? 'page' : undefined}
                  className="rounded-md px-2.5 py-1 transition"
                  style={{
                    color: isActive ? 'var(--ink)' : 'var(--ink-secondary)',
                    background: isActive ? 'color-mix(in srgb, var(--ink) 6%, transparent)' : undefined,
                    fontWeight: isActive ? 550 : 400,
                  }}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <span className="chip" title="Current reporting day — rolls over at 06:00 IST">
              <span className="muted">Today</span>
              {formatReportDateLabel(today)}
            </span>
            <form action={logoutAction}>
              <button type="submit" className="btn">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
