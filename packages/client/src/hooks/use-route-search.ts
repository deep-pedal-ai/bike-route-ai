import { useState } from 'react';

import { searchRoutes } from '../api/route-search';

import type { RouteSearchResult } from '@bike-route-ai/shared';

// The natural-language route-search state machine, lifted verbatim from
// GeneratePage so the Generate page and the Map tab share one implementation.
// `results` is null until a search resolves (and is blanked at the start of
// every search) — callers distinguish "no search yet / loading / error" from
// "search returned an empty list" via the (isLoading, results, error) triple,
// NOT a single boolean. `clear()` returns to the pristine idle state.
export type UseRouteSearch = {
  query: string;
  setQuery: (query: string) => void;
  isLoading: boolean;
  results: RouteSearchResult[] | null;
  filtersRelaxed: boolean;
  error: string | null;
  search: (query: string) => Promise<void>;
  clear: () => void;
};

export function useRouteSearch(): UseRouteSearch {
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<RouteSearchResult[] | null>(null);
  const [filtersRelaxed, setFiltersRelaxed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async (q: string) => {
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

  const clear = () => {
    setQuery('');
    setResults(null);
    setFiltersRelaxed(false);
    setError(null);
  };

  return {
    query,
    setQuery,
    isLoading,
    results,
    filtersRelaxed,
    error,
    search,
    clear,
  };
}
