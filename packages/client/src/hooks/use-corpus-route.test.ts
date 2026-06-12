import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useCorpusRoute } from './use-corpus-route';
import fixture from '../fixtures/corpus-sample.json';

describe('useCorpusRoute', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not fetch when id is null', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useCorpusRoute(null));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('fetches the detail URL ending in the id and resolves the Feature', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => fixture.routeDetail,
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useCorpusRoute(286));

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl.endsWith('/api/corpus/routes/286')).toBe(true);
    expect(result.current.data).toEqual(fixture.routeDetail);
    expect(result.current.error).toBeNull();
  });

  it('sets error and loading false on a non-200 (404) response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'not found', statusCode: 404 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useCorpusRoute(999));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.data).toBeNull();
  });

  it('refetches with the new id when id changes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => fixture.routeDetail,
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result, rerender } = renderHook(
      ({ id }: { id: number | null }) => useCorpusRoute(id),
      { initialProps: { id: 133 } },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect((fetchMock.mock.calls[0][0] as string).endsWith('/api/corpus/routes/133')).toBe(true);

    rerender({ id: 286 });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect((fetchMock.mock.calls[1][0] as string).endsWith('/api/corpus/routes/286')).toBe(true);
  });
});
