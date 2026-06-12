import { useState } from 'react';
import { AlertTriangle, Bike, Sparkles } from 'lucide-react';
import Header from './components/Header';
import SearchBar from './components/SearchBar';
import QuickQueries from './components/QuickQueries';
import LoadingSkeleton from './components/LoadingSkeleton';
import RouteResults from './components/RouteResults';
import { searchRoutes } from './api/route-search';
import type { RouteSearchResult } from '@bike-route-ai/shared';

export default function App() {
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<RouteSearchResult[] | null>(null);
  const [filtersRelaxed, setFiltersRelaxed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async (q: string) => {
    if (!q.trim() || isLoading) return;
    setIsLoading(true);
    setResults(null);
    setFiltersRelaxed(false);
    setError(null);

    try {
      const response = await searchRoutes(q.trim());
      setResults(response.results);
      setFiltersRelaxed(response.filtersRelaxed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Route search failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerate = () => generate(query);

  const handleQuickSelect = (q: string) => {
    setQuery(q);
    generate(q);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <Header />

      <main className="mx-auto max-w-5xl px-4 pb-24">

        {/* Hero */}
        <section className="py-16 text-center sm:py-24">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-lime-400/20 bg-lime-400/5 px-4 py-1.5">
            <Sparkles className="h-3.5 w-3.5 text-lime-400" />
            <span className="text-xs font-medium text-lime-400">Natural-language route search</span>
          </div>

          <h1 className="mb-4 text-4xl font-extrabold tracking-tight text-zinc-100 sm:text-5xl lg:text-6xl">
            Find your perfect<br />
            <span className="text-lime-400">ride</span>
          </h1>
          <p className="mb-10 text-base text-zinc-500 sm:text-lg">
            Describe the ride you want and compare the closest real corpus routes.
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
        {(isLoading || results || error) && (
          <section className="border-t border-zinc-800/60 pt-12">
            {isLoading && <LoadingSkeleton />}
            {!isLoading && error && (
              <div className="flex items-start gap-3 rounded-lg border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-100">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-300" />
                <p>{error}</p>
              </div>
            )}
            {!isLoading && results && <RouteResults results={results} filtersRelaxed={filtersRelaxed} />}
          </section>
        )}

        {/* Empty state */}
        {!isLoading && !results && !error && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900">
              <Bike className="h-8 w-8 text-zinc-700" />
            </div>
            <p className="text-sm text-zinc-600">Matching routes will appear here</p>
          </div>
        )}

      </main>
    </div>
  );
}
