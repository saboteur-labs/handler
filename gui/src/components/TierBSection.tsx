import type { TierBDetail } from '@/api/types';

interface TierBSectionProps {
  readonly tierB: TierBDetail | null;
}

function getFlagStatusClass(status: string): string {
  if (status === 'outlier') return 'text-yellow-500';
  if (status === 'n/a') return 'text-fg-faint';
  return 'text-fg-secondary';
}

export function TierBSection({ tierB }: TierBSectionProps): JSX.Element {
  if (tierB === null) {
    return (
      <p className="text-fg-tertiary text-sm font-mono">Tier B: insufficient history</p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="font-mono text-xs uppercase tracking-label text-fg-tertiary">
        Tier B — Reference-Relative
      </p>
      {tierB.flags !== undefined && tierB.flags.length > 0 && (
        <ul className="space-y-1">
          {tierB.flags.map((flag) => (
            <li key={flag.dimension} className="flex items-center gap-2 text-sm font-mono">
              <span className="text-fg-tertiary">{flag.dimension}:</span>
              <span className={getFlagStatusClass(flag.status)}>{flag.status}</span>
            </li>
          ))}
        </ul>
      )}
      {tierB.contract !== undefined && (
        <p className="text-sm font-mono">
          <span className="text-fg-tertiary">contract: </span>
          <span
            className={
              tierB.contract.status === 'pass' ? 'text-green-500' : 'text-brand-red'
            }
          >
            {tierB.contract.status}
          </span>
        </p>
      )}
    </div>
  );
}
