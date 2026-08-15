import { AppShell } from '@/app/components/AppShell';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Stores · Daily Sales Verification' };

export default function StoresPage() {
  return (
    <AppShell>
      <h1 className="text-lg font-semibold tracking-tight">Stores</h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Shopify and Square stores are added here at runtime — nothing is hardcoded.
      </p>

      <div className="mt-6 rounded-lg border border-dashed border-slate-300 p-6 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
        <p className="font-medium text-slate-700 dark:text-slate-200">Phase 1 — foundation</p>
        <p className="mt-2">
          Add / edit / deactivate with live credential validation and token encryption arrives in
          Phase 2. The schema and AES-256-GCM helpers backing it are already in place.
        </p>
      </div>
    </AppShell>
  );
}
