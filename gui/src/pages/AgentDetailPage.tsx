import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchAgentDetail } from '@/api/client';
import type { AgentDetail } from '@/api/types';
import { RunHistoryTable } from '@/components/RunHistoryTable';

export function AgentDetailPage(): JSX.Element {
  const { identity } = useParams<{ identity: string }>();
  const navigate = useNavigate();
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!identity) return;
    fetchAgentDetail(decodeURIComponent(identity))
      .then((detail) => {
        if (detail === null) {
          setNotFound(true);
        } else {
          setAgent(detail);
        }
      })
      .catch(() => setError('Failed to load agent detail'))
      .finally(() => setLoading(false));
  }, [identity]);

  return (
    <div className="min-h-screen bg-brand-black flex flex-col items-start justify-start p-8">
      <button
        className="font-mono text-fg-tertiary text-sm tracking-label uppercase mb-8 hover:text-fg-primary transition-colors"
        onClick={() => void navigate('/')}
      >
        ← Back to roster
      </button>

      {loading && (
        <p className="text-fg-tertiary font-mono text-sm">Loading agent detail...</p>
      )}

      {!loading && notFound && (
        <p className="text-brand-red font-mono text-sm">Agent not found</p>
      )}

      {!loading && error !== null && (
        <p className="text-brand-red font-mono text-sm">{error}</p>
      )}

      {!loading && agent !== null && (
        <main className="w-full max-w-5xl">
          <header className="mb-8">
            <h1 className="font-display font-bold text-fg-primary tracking-heading text-3xl leading-tight">
              {agent.name}
            </h1>
            <p className="font-mono text-fg-tertiary tracking-label text-xs mt-2 uppercase">
              {agent.sourceType} — {agent.sourcePath}
            </p>
          </header>

          <section>
            <h2 className="font-display font-bold text-fg-primary tracking-heading text-xl mb-4">
              Run History
            </h2>
            <RunHistoryTable runs={agent.runs} />
          </section>
        </main>
      )}
    </div>
  );
}
