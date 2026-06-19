import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { AgentSummary } from '@/api/types';

interface RosterTableProps {
  readonly agents: AgentSummary[];
  readonly onSelect: (agent: AgentSummary) => void;
}

function formatLastRun(lastRunDate: string | null): string {
  if (lastRunDate === null) {
    return 'Never';
  }
  return new Date(lastRunDate).toLocaleDateString();
}

export function RosterTable({ agents, onSelect }: RosterTableProps): JSX.Element {
  if (agents.length === 0) {
    return (
      <p className="text-fg-tertiary font-mono text-sm py-8">No agents found.</p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent cursor-default">
          <TableHead>Name</TableHead>
          <TableHead>Source Type</TableHead>
          <TableHead>Last Run</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {agents.map((agent) => (
          <TableRow key={agent.identityKey} onClick={() => onSelect(agent)}>
            <TableCell className="font-mono text-fg-primary">{agent.name}</TableCell>
            <TableCell className="text-fg-secondary font-mono text-xs uppercase tracking-label">
              {agent.sourceType}
            </TableCell>
            <TableCell className="text-fg-tertiary font-mono text-xs">
              {formatLastRun(agent.lastRunDate)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
