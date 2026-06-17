import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

import { useRouteSearch } from './use-route-search';
import { searchRoutes } from '../api/route-search';

import type { RouteSearchResult } from '@bike-route-ai/shared';

// The hook is the lifted GeneratePage state machine; we mock the API boundary
// (searchRoutes) and assert the state transitions the UI depends on.
vi.mock('../api/route-search', () => ({
  searchRoutes: vi.fn(),
}));

const searchRoutesMock = vi.mocked(searchRoutes);

const oneResult: RouteSearchResult[] = [
  {
    id: '286',
    name: 'Old Croton Aqueduct',
    distanceKm: 26,
    ascentM: 120,
    isLoop: false,
    qualityScore: 0.8,
    surfaceBreakdown: { paved: 1 },
    blurb: 'A shaded out-and-back along the aqueduct.',
  },
];

describe('useRouteSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts idle with no results, no error, not loading', () => {
    const { result } = renderHook(() => useRouteSearch());

    expect(result.current.results).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.filtersRelaxed).toBe(false);
  });

  it('loads, then resolves with results and filtersRelaxed from the response', async () => {
    searchRoutesMock.mockResolvedValue({ results: oneResult, filtersRelaxed: true });

    const { result } = renderHook(() => useRouteSearch());

    await act(async () => {
      await result.current.search('quiet riverside loop');
    });

    expect(searchRoutesMock).toHaveBeenCalledWith('quiet riverside loop', undefined);
    expect(result.current.results).toEqual(oneResult);
    expect(result.current.filtersRelaxed).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('passes the region through to searchRoutes so results stay in-metro', async () => {
    searchRoutesMock.mockResolvedValue({ results: oneResult, filtersRelaxed: false });

    const { result } = renderHook(() => useRouteSearch('ny'));

    await act(async () => {
      await result.current.search('riverside loop');
    });

    expect(searchRoutesMock).toHaveBeenCalledWith('riverside loop', 'ny');
  });

  it('clears results to null while a new search is in flight', async () => {
    searchRoutesMock.mockResolvedValue({ results: oneResult, filtersRelaxed: false });
    const { result } = renderHook(() => useRouteSearch());

    // First search populates results.
    await act(async () => {
      await result.current.search('first');
    });
    expect(result.current.results).toEqual(oneResult);

    // A second, slow search must blank results (so the panel can show loading)
    // BEFORE it resolves — proving results===null during the in-flight window.
    let release: (() => void) | undefined;
    searchRoutesMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ results: oneResult, filtersRelaxed: false });
        }),
    );

    let pending: Promise<void>;
    act(() => {
      pending = result.current.search('second');
    });

    await waitFor(() => expect(result.current.isLoading).toBe(true));
    expect(result.current.results).toBeNull();

    await act(async () => {
      release?.();
      await pending;
    });
    expect(result.current.results).toEqual(oneResult);
  });

  it('captures the error message and leaves results null on failure', async () => {
    searchRoutesMock.mockRejectedValue(new Error('Search unavailable'));

    const { result } = renderHook(() => useRouteSearch());

    await act(async () => {
      await result.current.search('quiet loop');
    });

    expect(result.current.error).toBe('Search unavailable');
    expect(result.current.results).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('ignores an empty/whitespace query (no API call)', async () => {
    const { result } = renderHook(() => useRouteSearch());

    await act(async () => {
      await result.current.search('   ');
    });

    expect(searchRoutesMock).not.toHaveBeenCalled();
    expect(result.current.results).toBeNull();
  });

  it('clear() resets query, results, error and filtersRelaxed', async () => {
    searchRoutesMock.mockResolvedValue({ results: oneResult, filtersRelaxed: true });
    const { result } = renderHook(() => useRouteSearch());

    act(() => result.current.setQuery('something'));
    await act(async () => {
      await result.current.search('something');
    });
    expect(result.current.results).toEqual(oneResult);

    act(() => result.current.clear());

    expect(result.current.query).toBe('');
    expect(result.current.results).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.filtersRelaxed).toBe(false);
  });
});
