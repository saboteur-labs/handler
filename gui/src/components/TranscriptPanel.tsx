import { useState } from 'react';
import { fetchRunTranscript } from '@/api/client';
import type { RunTranscriptData, TranscriptToolCallData } from '@/api/types';

interface TranscriptPanelProps {
  readonly runId: string;
}

type TranscriptState = RunTranscriptData | null | 'loading';

function ToolCallBlock({ call }: { readonly call: TranscriptToolCallData }): JSX.Element {
  const result = call.result;

  let resultContent: JSX.Element;
  if (result === undefined) {
    resultContent = <span className="text-fg-faint italic">(no result)</span>;
  } else if (result.isError) {
    resultContent = (
      <>
        <span className="text-brand-red font-mono text-xs">[error]</span>{' '}
        <span className="text-fg-secondary">{result.content}</span>
        {result.truncated && <span className="text-fg-faint italic ml-1">(truncated)</span>}
      </>
    );
  } else {
    resultContent = (
      <>
        <span className="text-fg-secondary">{result.content}</span>
        {result.truncated && <span className="text-fg-faint italic ml-1">(truncated)</span>}
      </>
    );
  }

  return (
    <div className="border border-brand-dim rounded-md overflow-hidden">
      <div className="bg-brand-surface2 px-3 py-2 border-b border-brand-dim">
        <span className="font-mono text-xs text-fg-tertiary uppercase tracking-label">
          tool call
        </span>
        <span className="font-mono text-sm text-fg-primary ml-2 font-medium">{call.name}</span>
      </div>
      <pre className="font-mono text-sm text-fg-secondary bg-brand-black px-3 py-2 overflow-x-auto whitespace-pre-wrap">
        {JSON.stringify(call.input, null, 2)}
      </pre>
      <div className="bg-brand-surface2 px-3 py-2 border-t border-brand-dim font-mono text-sm">
        <span className="text-fg-tertiary text-xs uppercase tracking-label mr-2">result:</span>
        {resultContent}
      </div>
    </div>
  );
}

function TranscriptContent({
  transcript,
}: {
  readonly transcript: RunTranscriptData;
}): JSX.Element {
  return (
    <div className="space-y-6 pt-4">
      {transcript.taskPrompt !== undefined ? (
        <div className="space-y-1">
          <p className="font-mono text-xs uppercase tracking-label text-fg-tertiary">Task prompt</p>
          <p className="text-sm text-fg-secondary leading-snug whitespace-pre-wrap">
            {transcript.taskPrompt}
          </p>
        </div>
      ) : (
        <p className="text-fg-faint text-sm font-mono italic">Task prompt not available.</p>
      )}

      {transcript.turns.length > 0 && (
        <div className="space-y-4">
          {transcript.turns.map((turn, turnIndex) => (
            <div key={turnIndex} className="space-y-3">
              {turn.textBlocks.map((block, blockIndex) => (
                <p
                  key={blockIndex}
                  className="text-sm text-fg-secondary leading-snug whitespace-pre-wrap"
                >
                  {block}
                </p>
              ))}
              {turn.toolCalls.map((call) => (
                <ToolCallBlock key={call.id} call={call} />
              ))}
            </div>
          ))}
        </div>
      )}

      <p className="font-mono text-xs text-fg-faint border-t border-brand-dim pt-3">
        Stop reason: {transcript.stopReason ?? 'unknown'}
      </p>
    </div>
  );
}

export function TranscriptPanel({ runId }: TranscriptPanelProps): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptState>(null);

  function handleToggle(open: boolean): void {
    setIsOpen(open);
    if (open && !hasOpened) {
      setHasOpened(true);
      setTranscript('loading');
      fetchRunTranscript(runId)
        .then((data) => setTranscript(data))
        .catch(() => setTranscript(null));
    }
  }

  return (
    <details
      open={isOpen}
      onToggle={(e) => handleToggle((e.currentTarget as HTMLDetailsElement).open)}
      className="border border-brand-dim rounded-md overflow-hidden"
    >
      <summary className="cursor-pointer select-none px-4 py-3 bg-brand-surface2 font-mono text-xs uppercase tracking-label text-fg-tertiary hover:text-fg-secondary transition-colors list-none flex items-center gap-2">
        <span className="text-fg-faint">{isOpen ? '▾' : '▸'}</span>
        Run Transcript
      </summary>

      <div className="px-4 pb-4">
        {transcript === 'loading' && (
          <p className="text-fg-tertiary font-mono text-sm pt-4">Loading transcript...</p>
        )}

        {transcript === null && hasOpened && (
          <p className="text-muted-foreground text-sm font-mono pt-4">
            Transcript not available for this run.
          </p>
        )}

        {transcript !== null && transcript !== 'loading' && (
          <TranscriptContent transcript={transcript} />
        )}
      </div>
    </details>
  );
}
