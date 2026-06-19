import type { ConventionsCheckResult } from '@/api/types';

interface ConventionsSectionProps {
  readonly results: ConventionsCheckResult[] | null;
}

function getPassClass(passed: boolean): string {
  return passed ? 'text-green-500' : 'text-brand-red';
}

export function ConventionsSection({ results }: ConventionsSectionProps): JSX.Element {
  if (results === null) {
    return (
      <section className="mt-8">
        <h2 className="font-display font-semibold text-fg-primary tracking-heading text-xl mb-4">
          Conventions
        </h2>
        <p className="text-fg-tertiary font-mono text-sm">No conventions check results</p>
      </section>
    );
  }

  return (
    <section className="mt-8">
      <h2 className="font-display font-semibold text-fg-primary tracking-heading text-xl mb-4">
        Conventions
      </h2>
      <ul className="space-y-2">
        {results.map((check) => (
          <li key={check.checkId} className="space-y-1">
            <div className="flex items-center gap-3">
              <span className={`font-mono text-sm font-medium ${getPassClass(check.passed)}`}>
                {check.passed ? '✓' : '✗'}
              </span>
              <span className="font-mono text-sm text-fg-secondary">{check.label}</span>
              <span className={`font-mono text-xs uppercase tracking-label ${getPassClass(check.passed)}`}>
                {check.passed ? 'Pass' : 'Fail'}
              </span>
            </div>
            {!check.passed && check.detail !== null && (
              <p className="ml-6 text-fg-tertiary text-sm font-mono">{check.detail}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
