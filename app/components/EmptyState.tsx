import Link from 'next/link';
import type { ReactNode } from 'react';

export function EmptyState({
  title,
  body,
  actionHref,
  actionLabel,
  tone = 'neutral',
}: {
  title: string;
  body: ReactNode;
  actionHref?: string;
  actionLabel?: string;
  tone?: 'neutral' | 'critical';
}) {
  return (
    <div
      className="card px-6 py-10 text-center"
      style={tone === 'critical' ? { borderColor: 'var(--critical)' } : undefined}
    >
      <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
        {title}
      </p>
      <div className="mx-auto mt-2 max-w-xl text-sm secondary-ink">{body}</div>
      {actionHref && actionLabel ? (
        <Link href={actionHref} className="btn btn-primary mt-5">
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}
