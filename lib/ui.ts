/** Presentation helpers shared by the report and store pages. */

/**
 * Categorical hues are assigned in fixed slot order and never cycled — a ninth
 * store gets a neutral, not a generated hue. Store identity is always carried
 * by its name in text as well, so colour is never the sole encoding.
 */
const SERIES_SLOTS = 8;

export function storeColor(index: number): string {
  if (index < 0 || index >= SERIES_SLOTS) return 'var(--ink-muted)';
  return `var(--series-${index + 1})`;
}

export function buildStoreColorMap(storeIds: string[]): Map<string, string> {
  return new Map(storeIds.map((id, index) => [id, storeColor(index)]));
}

export type Tone = 'good' | 'warning' | 'serious' | 'critical' | 'neutral';

export function toneColor(tone: Tone): string {
  switch (tone) {
    case 'good':
      return 'var(--good)';
    case 'warning':
      return 'var(--warning)';
    case 'serious':
      return 'var(--serious)';
    case 'critical':
      return 'var(--critical)';
    default:
      return 'var(--ink-muted)';
  }
}

/** Map a platform financial status onto a status tone. */
export function statusTone(status: string | null): Tone {
  if (!status) return 'neutral';
  const value = status.toUpperCase();
  if (value.includes('REFUND')) return 'serious';
  if (value.includes('VOID') || value.includes('CANCEL')) return 'critical';
  if (value.includes('PENDING') || value.includes('AUTHORIZED') || value === 'OPEN') {
    return 'warning';
  }
  if (value.includes('PAID') || value === 'COMPLETED') return 'good';
  return 'neutral';
}

export function humanizeStatus(status: string | null): string {
  if (!status) return '—';
  return status
    .toLowerCase()
    .split(/[_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function relativeTime(from: Date | null, now: Date = new Date()): string {
  if (!from) return 'never';
  const seconds = Math.round((now.getTime() - from.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
