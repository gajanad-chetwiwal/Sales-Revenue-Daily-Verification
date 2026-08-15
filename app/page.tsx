import { AppShell } from '@/app/components/AppShell';
import {
  formatIstDateTime,
  formatReportDateLabel,
  getCurrentReportDate,
  reportDayRange,
} from '@/lib/reportDate';

export const dynamic = 'force-dynamic';

export default function DailyReportPage() {
  const today = getCurrentReportDate();
  const { start, endExclusive } = reportDayRange(today);

  return (
    <AppShell>
      <h1 className="text-lg font-semibold tracking-tight">Daily sales report</h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Reporting day {formatReportDateLabel(today)} — orders created between{' '}
        {formatIstDateTime(start)} and {formatIstDateTime(new Date(endExclusive.getTime() - 1000))}{' '}
        IST.
      </p>

      <div className="mt-6 rounded-lg border border-dashed border-slate-300 p-6 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
        <p className="font-medium text-slate-700 dark:text-slate-200">Phase 1 — foundation</p>
        <p className="mt-2">
          The summary strip and transactions table land in Phase 4, once Shopify sync (Phase 3) is
          populating the database. The reporting-day rule driving the date above is already live and
          unit-tested.
        </p>
      </div>
    </AppShell>
  );
}
