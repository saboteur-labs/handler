import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchAgents } from '@/api/client';
import type { AgentSummary } from '@/api/types';
import { RosterTable } from '@/components/RosterTable';

export function RosterPage(): JSX.Element {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    fetchAgents()
      .then((data) => {
        setAgents(data);
      })
      .catch(() => {
        setError('Failed to load agents.');
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  function handleSelect(agent: AgentSummary): void {
    void navigate(`/agents/${encodeURIComponent(agent.identityKey)}`);
  }

  return (
    <div className="min-h-screen bg-brand-black flex flex-col items-start justify-start p-8">
      <header className="mb-8">
        <h1 className="font-display font-bold text-fg-primary tracking-wordmark text-4xl leading-tight">
          handler
        </h1>
        <p className="font-mono text-fg-tertiary tracking-label text-sm mt-2 uppercase">
          subagent observability
        </p>
      </header>
      <main className="w-full max-w-4xl">
        <h2 className="font-display font-bold text-fg-primary tracking-heading text-xl mb-6">
          Agents
        </h2>
        {loading && <p className="text-fg-tertiary font-mono text-sm">Loading agents...</p>}
        {!loading && error !== null && <p className="text-brand-red font-mono text-sm">{error}</p>}
        {!loading && error === null && <RosterTable agents={agents} onSelect={handleSelect} />}
      </main>
    </div>
  );
}
