import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFacilities } from './use-facilities';
import fixture from '../fixtures/corpus-sample.json';

import type { Bbox } from '@bike-route-ai/shared';

const BBOX_A: Bbox = [-74.0, 40.6, -73.9, 40.8];
const BBOX_B: Bbox = [-74.1, 40.5, -73.8, 40.9];

function makeFetchMock() {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ ...fixture.facilities, truncated: false, count: 5 }),
  });
}

describe('useFacilities', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('issues no request while disabled, even after the debounce window', async () => {
    const fetchMock = makeFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useFacilities(BBOX_A, undefined, false));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('issues exactly one request after enabling and waiting the debounce', async () => {
    const fetchMock = makeFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useFacilities(BBOX_A, undefined, enabled),
      { initialProps: { enabled: false } },
    );

    expect(fetchMock).not.toHaveBeenCalled();

    rerender({ enabled: true });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe('/api/corpus/facilities?bbox=-74,40.6,-73.9,40.8');
    expect(result.current.data).toEqual({ ...fixture.facilities, truncated: false, count: 5 });
    expect(result.current.error).toBeNull();
  });

  it('issues another request when the bbox changes', async () => {
    const fetchMock = makeFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    const { rerender } = renderHook(
      ({ bbox }: { bbox: Bbox }) => useFacilities(bbox, undefined, true),
      { initialProps: { bbox: BBOX_A } },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    rerender({ bbox: BBOX_B });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0] as string).toBe(
      '/api/corpus/facilities?bbox=-74.1,40.5,-73.8,40.9',
    );
  });

  it('debounces rapid bbox changes into a single request', async () => {
    const fetchMock = makeFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    const { rerender } = renderHook(
      ({ bbox }: { bbox: Bbox }) => useFacilities(bbox, undefined, true),
      { initialProps: { bbox: BBOX_A } },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    rerender({ bbox: BBOX_B });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0] as string).toBe(
      '/api/corpus/facilities?bbox=-74.1,40.5,-73.8,40.9',
    );
  });

  it('appends classes to the query string when provided', async () => {
    const fetchMock = makeFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useFacilities(BBOX_A, ['protected', 'greenway'], true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0] as string).toBe(
      '/api/corpus/facilities?bbox=-74,40.6,-73.9,40.8&classes=protected,greenway',
    );
  });

  it('does not fetch when bbox is null', async () => {
    const fetchMock = makeFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useFacilities(null, undefined, true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
