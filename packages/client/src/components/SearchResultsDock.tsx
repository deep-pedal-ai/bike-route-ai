import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, ChevronDown, Compass, Loader2, X } from 'lucide-react';
import RouteResultCardCompact from './RouteResultCardCompact';
import RouteDetailPanel from './RouteDetailPanel';
import type { Feature, LineString } from 'geojson';
import type {
  CorpusRouteDetailProps,
  RouteSearchResult,
} from '@bike-route-ai/shared';

type SearchResultsDockProps = {
  results: RouteSearchResult[] | null;
  /** Ids (string-normalized) of results whose route has geometry on the map. */
  mappableIds: Set<string>;
  /** Id (string-normalized) of the currently open route. */
  selectedId?: string | null;
  filtersRelaxed: boolean;
  isLoading: boolean;
  error: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  /** Frame (zoom to) a route as it scrolls into focus, without opening it. */
  onCenter: (id: string) => void;
  onClose: () => void;
  /** Detail feature for the open route — drives the expanded state. */
  detail: Feature<LineString, CorpusRouteDetailProps> | null;
  detailLoading: boolean;
  /** Collapse the expanded detail back to the peek carousel (clears selection). */
  onCollapseDetail: () => void;
};

// The mobile bottom dock — one surface in two states. Peek: a swipeable carousel
// of compact cards whose CENTERED card highlights its route on the map (the touch
// replacement for desktop hover). Expanded: the same surface grows to host the
// full RouteDetailPanel. Tapping a card (or the grabber, on the centered card)
// expands; the grabber / detail close collapses back to peek. The desktop
// SearchResultsPanel is untouched — MapExplorer picks one by viewport.
export default function SearchResultsDock({
  results,
  mappableIds,
  selectedId = null,
  filtersRelaxed,
  isLoading,
  error,
  onHover,
  onSelect,
  onCenter,
  onClose,
  detail,
  detailLoading,
  onCollapseDetail,
}: SearchResultsDockProps) {
  const expanded = selectedId !== null;
  const scrollRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  // Scroll-driven centered card; null until the user scrolls. The effective
  // centered id is DERIVED (not effect-seeded) so it defaults to the first result
  // and resets cleanly when a new search swaps the result set.
  const [scrolledId, setScrolledId] = useState<string | null>(null);
  const firstId = results && results.length > 0 ? String(results[0].id) : null;
  const centeredId =
    scrolledId !== null && results?.some((r) => String(r.id) === scrolledId)
      ? scrolledId
      : firstId;

  // Highlight follows the open route while expanded, the centered card otherwise.
  useEffect(() => {
    onHover(selectedId ?? centeredId);
  }, [selectedId, centeredId, onHover]);

  // As the user swipes, zoom the map to the card now centered (the one covering
  // most of the screen). Driven by the SCROLL id, not the derived fallback, so
  // the arrival overview (union of all results) stands until the user scrolls.
  useEffect(() => {
    if (expanded || scrolledId === null) return;
    if (mappableIds.has(scrolledId)) onCenter(scrolledId);
  }, [scrolledId, expanded, mappableIds, onCenter]);

  // rAF-throttled: find the card whose center is nearest the carousel's center.
  const onScroll = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const el = scrollRef.current;
      if (!el) return;
      const mid = el.scrollLeft + el.clientWidth / 2;
      let best: string | null = null;
      let bestDist = Infinity;
      for (const child of Array.from(el.children) as HTMLElement[]) {
        const id = child.dataset.cardId;
        if (!id) continue;
        const childMid = child.offsetLeft + child.offsetWidth / 2;
        const dist = Math.abs(childMid - mid);
        if (dist < bestDist) {
          bestDist = dist;
          best = id;
        }
      }
      setScrolledId((prev) => (best !== null && best !== prev ? best : prev));
    });
  }, []);

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  const count = results?.length ?? 0;
  const headline = isLoading
    ? 'Searching…'
    : error !== null
      ? 'Search failed'
      : `${count} ${count === 1 ? 'route' : 'routes'} matched`;

  // Grabber action in peek: open the centered route. In expanded: collapse.
  const onGrabber = () => {
    if (expanded) {
      onCollapseDetail();
    } else if (centeredId !== null && mappableIds.has(centeredId)) {
      onSelect(centeredId);
    }
  };

  return (
    <aside
      aria-label="Route search results"
      style={{ height: expanded ? '82dvh' : 'clamp(168px, 34dvh, 288px)' }}
      className="dock-motion fixed inset-x-0 bottom-0 z-20 flex flex-col overflow-hidden rounded-t-2xl border-t border-[var(--color-bark-border)] bg-[var(--color-forest)]/95 shadow-[0_-18px_45px_rgba(16,20,15,0.5)] backdrop-blur-md transition-[height] duration-300 ease-out"
    >
      <div className="flex items-center gap-2 px-4 pt-2">
        <button
          type="button"
          onClick={onGrabber}
          aria-label={expanded ? 'Collapse details' : 'Open the centered route'}
          className="group flex flex-1 flex-col items-center gap-1.5 rounded-lg py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-leaf)]"
        >
          <span className="h-1 w-10 rounded-full bg-[var(--color-bark-border)] transition group-hover:bg-[var(--color-leaf)]" />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close search"
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-md border border-[var(--color-bark-border)] bg-[var(--color-bark-soft)] text-[var(--color-sage-text)] transition hover:bg-[var(--color-bark)] hover:text-[var(--color-cream)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-leaf)]"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {expanded ? (
        <div className="flex min-h-0 flex-1 flex-col px-3 pb-3">
          <button
            type="button"
            onClick={onCollapseDetail}
            className="mb-2 inline-flex items-center gap-1 self-start rounded-md px-2 py-2 text-xs font-medium text-[var(--color-sage-text)] hover:text-[var(--color-cream)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-leaf)]"
          >
            <ChevronDown className="h-4 w-4" />
            Back to results
          </button>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {detail !== null ? (
              <RouteDetailPanel route={detail} onClose={onCollapseDetail} />
            ) : (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-[var(--color-sage-text)]">
                {detailLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading route…
                  </>
                ) : (
                  'No detail available.'
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-baseline justify-between px-4 pb-1">
            <p className="text-[11px] uppercase tracking-wide text-[var(--color-sage-text)]">
              Search results
            </p>
            <p className="truncate text-sm font-semibold text-[var(--color-cream)]">
              {headline}
            </p>
          </div>

          {error !== null ? (
            <div className="mx-4 mb-4 flex items-start gap-2.5 rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-xs leading-5 text-red-100">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-300" />
              <p>{error}</p>
            </div>
          ) : isLoading ? (
            <div className="flex flex-1 items-center justify-center gap-2 text-sm text-[var(--color-sage-text)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              Searching…
            </div>
          ) : results !== null && results.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
              <Compass className="h-6 w-6 text-[var(--color-moss-muted)]" />
              <p className="text-sm text-[var(--color-sage-text)]">
                No routes matched your search.
              </p>
            </div>
          ) : results !== null ? (
            <>
              {filtersRelaxed && (
                <div className="mx-4 mb-1 flex items-start gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[11px] leading-4 text-amber-100">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-300" />
                  <p>Closest corpus routes shown — none exactly matched those filters.</p>
                </div>
              )}
              <div
                ref={scrollRef}
                onScroll={onScroll}
                className="flex min-h-0 flex-1 snap-x snap-mandatory gap-3 overflow-x-auto overflow-y-hidden px-4 pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                {results.map((result, index) => {
                  const id = String(result.id);
                  const rank = index + 1;
                  const mappable = mappableIds.has(id);
                  return (
                    <div
                      key={id}
                      data-card-id={id}
                      className="flex w-[82%] flex-shrink-0 snap-center"
                    >
                      {mappable ? (
                        <button
                          type="button"
                          onClick={() => onSelect(id)}
                          aria-label={`Focus ${result.name} on the map`}
                          aria-current={id === selectedId ? 'true' : undefined}
                          className="w-full rounded-xl text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-leaf)]"
                        >
                          <RouteResultCardCompact result={result} rank={rank} />
                        </button>
                      ) : (
                        <div className="pointer-events-none w-full opacity-60">
                          <RouteResultCardCompact result={result} rank={rank} unmappable />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          ) : null}
        </>
      )}
    </aside>
  );
}
