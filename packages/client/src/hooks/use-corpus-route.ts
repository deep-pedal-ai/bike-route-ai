import { useEffect, useState } from 'react';

import type { CorpusRouteDetailResponse } from '@bike-route-ai/shared';

type UseCorpusRouteResult = {
  data: CorpusRouteDetailResponse | null;
  loading: boolean;
  error: Error | null;
};

export function useCorpusRoute(id: number | null): UseCorpusRouteResult {
  const [data, setData] = useState<CorpusRouteDetailResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    const run = async (): Promise<void> => {
      if (id === null) {
        setData(null);
        setLoading(false);
        setError(null);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/corpus/routes/' + id, { signal: controller.signal });
        if (!res.ok) {
          throw new Error('Request failed with status ' + res.status);
        }
        const json: unknown = await res.json();
        if (controller.signal.aborted) return;
        setData(json as CorpusRouteDetailResponse);
        setLoading(false);
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err : new Error('Unknown error'));
        setLoading(false);
      }
    };

    void run();

    return () => {
      controller.abort();
    };
  }, [id]);

  return { data, loading, error };
}
