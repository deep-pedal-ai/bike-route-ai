import { AlertTriangle, Bike, Sparkles } from 'lucide-react';
import SearchBar from '../components/SearchBar';
import QuickQueries from '../components/QuickQueries';
import LoadingSkeleton from '../components/LoadingSkeleton';
import RouteResults from '../components/RouteResults';
import { useRouteSearch } from '../hooks/use-route-search';

export default function GeneratePage() {
  const { query, setQuery, isLoading, results, filtersRelaxed, error, search } =
    useRouteSearch();

  const handleGenerate = () => search(query);

  const handleQuickSelect = (q: string) => {
    setQuery(q);
    search(q);
  };

  return (
    <main className="mx-auto max-w-5xl px-4 pb-24">

      {/* Hero */}
      <section className="py-16 text-center sm:py-24">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[var(--color-leaf-border)] bg-[var(--color-leaf-wash)] px-4 py-1.5">
          <Sparkles className="h-3.5 w-3.5 text-[var(--color-leaf)]" />
          <span className="text-xs font-medium text-[var(--color-sage-text)]">Natural-language route search</span>
        </div>

        <h1 className="mb-4 text-4xl font-extrabold tracking-tight text-[var(--color-ink)] sm:text-5xl lg:text-6xl">
          Find your perfect<br />
          <span className="text-[var(--color-leaf)]">ride</span>
        </h1>
        <p className="mb-10 text-base text-[var(--color-moss-muted)] sm:text-lg">
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
        <section className="border-t border-[var(--color-bark-border)] pt-12">
          {isLoading && <LoadingSkeleton />}
          {!isLoading && error && (
            <div className="flex items-start gap-3 rounded-lg border border-[var(--color-danger-border)] bg-[var(--color-danger-wash)] p-4 text-sm text-[var(--color-danger)]">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--color-danger)]" />
              <p>{error}</p>
            </div>
          )}
          {!isLoading && results && <RouteResults results={results} filtersRelaxed={filtersRelaxed} />}
        </section>
      )}

      {/* Empty state */}
      {!isLoading && !results && !error && (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-[var(--color-bark-border)] bg-[var(--color-bark)]">
            <Bike className="h-8 w-8 text-[var(--color-moss-muted)]" />
          </div>
          <p className="text-sm text-[var(--color-moss-muted)]">Matching routes will appear here</p>
        </div>
      )}

    </main>
  );
}
