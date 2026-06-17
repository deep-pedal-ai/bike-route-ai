import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useCorpusRoutes } from './use-corpus-routes';
import fixture from '../fixtures/corpus-sample.json';

describe('useCorpusRoutes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts loading, then resolves with the FeatureCollection and loading false', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => fixture.routes,
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useCorpusRoutes());

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual(fixture.routes);
    expect(result.current.error).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/corpus/routes',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('scopes the request to ?region= when a region is given', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => fixture.routes,
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useCorpusRoutes('ny'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/corpus/routes?region=ny',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('sets error and loading false when fetch rejects', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useCorpusRoutes());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.data).toBeNull();
  });

  it('sets error and loading false on a non-200 response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'boom', statusCode: 500 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useCorpusRoutes());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.data).toBeNull();
  });
});
