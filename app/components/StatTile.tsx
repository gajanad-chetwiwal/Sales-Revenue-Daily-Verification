import { formatMinorGrouped } from '@/lib/money';

interface StatTileProps {
  label: string;
  minor?: bigint;
  currency?: string;
  count?: number;
  emphasis?: boolean;
  tone?: 'default' | 'negative';
}

/**
 * A stat tile, not a chart — the job here is reading an exact figure, and a
 * bar would only add ink. Values carry tabular figures so a row of tiles
 * aligns down the column.
 */
export function StatTile({ label, minor, currency, count, emphasis, tone }: StatTileProps) {
  const value =
    count !== undefined
      ? count.toLocaleString('en-US')
      : formatMinorGrouped(minor ?? 0n, currency ?? 'USD');

  const isNegative = tone === 'negative' && (minor ?? 0n) > 0n;

  return (
    <div className="px-4 py-3">
      <div className="stat-label">{label}</div>
      <div
        className={`stat-value mt-1 ${emphasis ? 'stat-value-lg' : ''}`}
        style={isNegative ? { color: 'var(--serious)' } : undefined}
      >
        {isNegative ? '−' : ''}
        {value}
      </div>
    </div>
  );
}
