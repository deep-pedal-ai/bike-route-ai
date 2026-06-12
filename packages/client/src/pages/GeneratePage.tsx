import { useState } from 'react';
import { Bike, Sparkles } from 'lucide-react';
import SearchBar from '../components/SearchBar';
import QuickQueries from '../components/QuickQueries';
import LoadingSkeleton from '../components/LoadingSkeleton';
import RouteResults from '../components/RouteResults';
import { matchRoute } from '../utils/match-route';
import type { RouteData } from '../types/route';

const LOADING_DELAY_MS = 1500;

export default function GeneratePage() {
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<RouteData | null>(null);

  const generate = (q: string) => {
    if (!q.trim() || isLoading) return;
    setIsLoading(true);
    setResult(null);
    setTimeout(() => {
      setResult(matchRoute(q));
      setIsLoading(false);
    }, LOADING_DELAY_MS);
  };

  const handleGenerate = () => generate(query);

  const handleQuickSelect = (q: string) => {
    setQuery(q);
    generate(q);
  };

  return (
    <main className="mx-auto max-w-5xl px-4 pb-24">

      {/* Hero */}
      <section className="py-16 text-center sm:py-24">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[var(--color-leaf-border)] bg-[var(--color-leaf-wash)] px-4 py-1.5">
          <Sparkles className="h-3.5 w-3.5 text-[var(--color-leaf)]" />
          <span className="text-xs font-medium text-[var(--color-sage-text)]">AI-powered route generation</span>
        </div>

        <h1 className="mb-4 text-4xl font-extrabold tracking-tight text-zinc-100 sm:text-5xl lg:text-6xl">
          Find your perfect<br />
          <span className="text-[var(--color-leaf)]">ride</span>
        </h1>
        <p className="mb-10 text-base text-zinc-500 sm:text-lg">
          Describe the ride you're dreaming of. VeloMind AI handles the rest.
        </p>

        <div className="mx-auto max-w-2xl space-y-4">
          <SearchBar
            query={query}
            onQueryChange={setQuery}
            onGenerate={handleGenerate}
            isLoading={isLoading}
          />
          <QuickQueries onSelect={handleQuickSelect} disabled={isLoading} />
        </div>
      </section>

      {/* Results */}
      {(isLoading || result) && (
        <section className="border-t border-zinc-800/60 pt-12">
          {isLoading ? <LoadingSkeleton /> : result && <RouteResults route={result} />}
        </section>
      )}

      {/* Empty state */}
      {!isLoading && !result && (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900">
            <Bike className="h-8 w-8 text-zinc-700" />
          </div>
          <p className="text-sm text-zinc-600">Your generated route will appear here</p>
        </div>
      )}

    </main>
  );
}
