import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { RunDetail } from '@/api/types';

interface RunHistoryTableProps {
  readonly runs: readonly RunDetail[];
}

function getBandClass(band: string): string {
  if (band === 'pass') return 'text-green-600';
  if (band === 'warn') return 'text-yellow-600';
  if (band === 'fail') return 'text-red-600';
  return 'text-fg-secondary';
}

export function RunHistoryTable({ runs }: RunHistoryTableProps): JSX.Element {
  const sorted = [...runs].sort((a, b) => {
    if (a.timestamp === undefined && b.timestamp === undefined) return 0;
    if (a.timestamp === undefined) return 1;
    if (b.timestamp === undefined) return -1;
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });

  if (sorted.length === 0) {
    return <p className="text-fg-tertiary font-mono text-sm">No runs ingested</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Run</TableHead>
          <TableHead>Duration</TableHead>
          <TableHead>Tokens</TableHead>
          <TableHead>Tool Uses</TableHead>
          <TableHead>Tier A Score</TableHead>
          <TableHead>Band</TableHead>
          <TableHead>Failing Checks</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((run) => {
          const runLabel =
            run.timestamp !== undefined
              ? new Date(run.timestamp).toLocaleString()
              : 'Unknown';

          const duration =
            run.totalDurationMs !== undefined ? `${run.totalDurationMs}ms` : '—';

          const tokens = run.totalTokens !== undefined ? String(run.totalTokens) : '—';

          const toolUses =
            run.totalToolUseCount !== undefined ? String(run.totalToolUseCount) : '—';

          const tierAScore =
            run.tierA !== null && run.tierA.composite !== null
              ? String(run.tierA.composite)
              : 'Unscored';

          const band = run.tierA !== null ? run.tierA.band : null;
          const bandClass = band !== null ? getBandClass(band) : 'text-fg-secondary';
          const bandLabel = band !== null ? band : '—';

          const failingChecks =
            run.tierA !== null && run.tierA.failingChecks.length > 0
              ? run.tierA.failingChecks
                  .filter((c) => c.status === 'warn' || c.status === 'fail')
                  .map((c) => c.label)
                  .join(', ') || '—'
              : '—';

          return (
            <TableRow key={run.runId}>
              <TableCell className="font-mono text-fg-secondary text-sm">{runLabel}</TableCell>
              <TableCell className="text-fg-secondary text-sm">{duration}</TableCell>
              <TableCell className="text-fg-secondary text-sm">{tokens}</TableCell>
              <TableCell className="text-fg-secondary text-sm">{toolUses}</TableCell>
              <TableCell className="text-fg-secondary text-sm">{tierAScore}</TableCell>
              <TableCell className={`text-sm font-medium ${bandClass}`}>{bandLabel}</TableCell>
              <TableCell className="text-fg-tertiary text-sm font-mono">{failingChecks}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
