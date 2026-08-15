import Link from 'next/link';
import type { ReactNode } from 'react';

import { logoutAction } from '@/app/login/actions';
import { formatReportDateLabel, getCurrentReportDate } from '@/lib/reportDate';

const NAV_LINKS = [
  { href: '/', label: 'Daily report' },
  { href: '/stores', label: 'Stores' },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const today = getCurrentReportDate();

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
          <span className="text-sm font-semibold tracking-tight">Daily Sales Verification</span>

          <nav className="flex items-center gap-4 text-sm">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-slate-600 transition hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-4">
            <span
              className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300"
              title="Current reporting day (06:00 IST rollover)"
            >
              {formatReportDateLabel(today)}
            </span>
            <form action={logoutAction}>
              <button
                type="submit"
                className="text-sm text-slate-500 transition hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
