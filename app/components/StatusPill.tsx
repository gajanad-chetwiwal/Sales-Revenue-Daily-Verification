import { humanizeStatus, statusTone, toneColor } from '@/lib/ui';

/**
 * Status colour never travels alone — the pill always shows the label too, so
 * the meaning survives colour-blindness, greyscale printing and forced-colors.
 */
export function StatusPill({ status }: { status: string | null }) {
  const tone = statusTone(status);
  return (
    <span className="status-pill" style={{ color: 'var(--ink-secondary)' }}>
      <span
        aria-hidden="true"
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: toneColor(tone),
          flex: 'none',
        }}
      />
      {humanizeStatus(status)}
    </span>
  );
}
