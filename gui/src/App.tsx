import { Button } from "@/components/ui/button";

export default function App(): React.JSX.Element {
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
      <main>
        <Button variant="outline">Get started</Button>
      </main>
    </div>
  );
}
