import type { TierCDetail } from '@/api/types';

interface TierCSectionProps {
  readonly tierC: TierCDetail | null;
}

export function TierCSection({ tierC }: TierCSectionProps): JSX.Element {
  if (tierC === null) {
    return (
      <p className="text-fg-tertiary text-sm font-mono">Tier C: not computed</p>
    );
  }

  const labelClass =
    tierC.label === 'pass' ? 'text-green-500' : 'text-brand-red';

  return (
    <div className="space-y-2">
      <p className="font-mono text-xs uppercase tracking-label text-fg-tertiary">
        Tier C — Judged Quality
      </p>
      <p className={`text-sm font-mono font-medium ${labelClass}`}>{tierC.label}</p>
      <p className="text-sm text-fg-secondary leading-snug">{tierC.reasoning}</p>
    </div>
  );
}
