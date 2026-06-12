import { AlertCircle, AlertTriangle, Compass, MapPinOff, X } from 'lucide-react';
import RouteResultCard from './RouteResultCard';
import LoadingSkeleton from './LoadingSkeleton';
import type { KeyboardEvent } from 'react';
import type { RouteSearchResult } from '@bike-route-ai/shared';

type SearchResultsPanelProps = {
  /** Resolved results, or null while loading / before the first search. */
  results: RouteSearchResult[] | null;
  /** Ids (string-normalized) of results whose route has geometry on the map. */
  mappableIds: Set<string>;
  filtersRelaxed: boolean;
  isLoading: boolean;
  error: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  onClose: () => void;
};

// The left-sliding results panel for the Map tab. It reuses the Generate page's
// RouteResultCard verbatim and wraps each card with the map-context affordances:
// a mappable card is a focusable button that highlights its route on hover and
// frames it on click; a route with no geometry is shown read-only with a
// "no map preview" hint (the detail endpoint requires geometry — D6). The panel
// also owns the loading / empty / error states, since `useRouteSearch` blanks
// `results` to null during a request — gating the panel on `results` alone would
// unmount it exactly when those states need to render.
export default function SearchResultsPanel({
  results,
  mappableIds,
  filtersRelaxed,
  isLoading,
  error,
  onHover,
  onSelect,
  onClose,
}: SearchResultsPanelProps) {
  const headline = isLoading
    ? 'Searching…'
    : error !== null
      ? 'Search failed'
      : `${results?.length ?? 0} ${results?.length === 1 ? 'route' : 'routes'} matched`;

  return (
    <aside
      aria-label="Route search results"
      className="search-panel-motion absolute bottom-3 left-3 top-3 z-20 flex w-[min(26rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-lg border border-[var(--color-bark-border)] bg-[var(--color-forest-panel)] shadow-[0_20px_55px_rgba(16,20,15,0.42)] backdrop-blur-md"
    >
      <header className="flex items-center justify-between gap-3 border-b border-[var(--color-bark-border)] px-4 py-3">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-[var(--color-sage-text)]">
            Search results
          </p>
          <p className="truncate text-sm font-semibold text-[var(--color-cream)]">{headline}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close search"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border border-[var(--color-bark-border)] bg-[var(--color-bark-soft)] text-[var(--color-sage-text)] transition hover:bg-[var(--color-bark)] hover:text-[var(--color-cream)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-leaf)]"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {error !== null ? (
          <div className="flex items-start gap-2.5 rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-xs leading-5 text-red-100">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-300" />
            <p>{error}</p>
          </div>
        ) : isLoading ? (
          <LoadingSkeleton />
        ) : results !== null && results.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--color-bark-border)] bg-[var(--color-bark-soft)]">
              <Compass className="h-6 w-6 text-[var(--color-moss-muted)]" />
            </div>
            <p className="text-sm text-[var(--color-sage-text)]">No routes matched your search.</p>
            <p className="text-xs text-[var(--color-moss-muted)]">
              Try a broader description or different distance.
            </p>
          </div>
        ) : results !== null ? (
          <>
            {filtersRelaxed && (
              <div className="flex items-start gap-2.5 rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-xs leading-5 text-amber-100">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-300" />
                <p>
                  No exact route satisfied those distance or loop filters. Closest corpus
                  routes are shown.
                </p>
              </div>
            )}

            {results.map((rawResult, index) => {
              const id = String(rawResult.id);
              const rank = index + 1;

              if (!mappableIds.has(id)) {
                return <UnmappableCard key={id} result={rawResult} rank={rank} />;
              }

              const select = () => onSelect(id);
              const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  select();
                }
              };

              return (
                <div
                  key={id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Focus ${rawResult.name} on the map`}
                  onClick={select}
                  onKeyDown={onKeyDown}
                  onMouseEnter={() => onHover(id)}
                  onMouseLeave={() => onHover(null)}
                  onFocus={() => onHover(id)}
                  onBlur={() => onHover(null)}
                  className="block rounded-lg outline-none transition duration-200 hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-[var(--color-leaf)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-forest)]"
                >
                  <RouteResultCard result={rawResult} rank={rank} />
                </div>
              );
            })}
          </>
        ) : null}
      </div>
    </aside>
  );
}

// A result whose route has no geometry: shown for context, but dimmed and
// non-interactive with a clear "no map preview" hint.
function UnmappableCard({ result, rank }: { result: RouteSearchResult; rank: number }) {
  return (
    <div className="relative rounded-lg opacity-70">
      <div className="pointer-events-none">
        <RouteResultCard result={result} rank={rank} />
      </div>
      <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full border border-[var(--color-bark-border)] bg-[var(--color-bark)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-sage-text)]">
        <MapPinOff className="h-3 w-3" />
        No map preview
      </span>
    </div>
  );
}
