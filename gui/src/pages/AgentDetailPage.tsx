import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchAgentDetail } from '@/api/client';
import type { AgentDetail, RunDetail } from '@/api/types';
import { RunHistoryTable } from '@/components/RunHistoryTable';
import { TierBSection } from '@/components/TierBSection';
import { TierCSection } from '@/components/TierCSection';
import { ConventionsSection } from '@/components/ConventionsSection';
import { NoteSection } from '@/components/NoteSection';

function runLabel(run: RunDetail): string {
  return run.timestamp !== undefined
    ? new Date(run.timestamp).toLocaleString()
    : run.runId.slice(0, 12);
}

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

      {loading && <p className="text-fg-tertiary font-mono text-sm">Loading agent detail...</p>}

      {!loading && notFound && <p className="text-brand-red font-mono text-sm">Agent not found</p>}

      {!loading && error !== null && <p className="text-brand-red font-mono text-sm">{error}</p>}

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

          {agent.runs.length > 0 && (
            <section className="mt-12">
              <h2 className="font-display font-bold text-fg-primary tracking-heading text-xl mb-6">
                Per-Run Details
              </h2>
              <div className="space-y-4">
                {[...agent.runs]
                  .sort((a, b) => {
                    if (a.timestamp === undefined && b.timestamp === undefined) return 0;
                    if (a.timestamp === undefined) return 1;
                    if (b.timestamp === undefined) return -1;
                    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
                  })
                  .map((run) => (
                    <div
                      key={run.runId}
                      className="bg-brand-surface border border-brand-dim rounded-md p-6 space-y-6"
                    >
                      <p className="font-mono text-fg-secondary text-sm border-b border-brand-dim pb-3">
                        {runLabel(run)}
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="bg-brand-surface2 rounded-md p-4">
                          <TierBSection tierB={run.tierB} />
                        </div>
                        <div className="bg-brand-surface2 rounded-md p-4">
                          <TierCSection tierC={run.tierC} />
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </section>
          )}

          <ConventionsSection results={agent.conventionsResults} />
          <NoteSection note={agent.note} />
        </main>
      )}
    </div>
  );
}
