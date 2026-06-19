interface NoteSectionProps {
  readonly note: string | null;
}

export function NoteSection({ note }: NoteSectionProps): JSX.Element | null {
  if (note === null) {
    return null;
  }

  return (
    <section className="mt-8">
      <h2 className="font-display font-semibold text-fg-primary tracking-heading text-xl mb-4">
        Note
      </h2>
      <pre className="font-mono text-sm bg-brand-surface text-fg-secondary p-4 rounded-md whitespace-pre-wrap">
        {note}
      </pre>
    </section>
  );
}
