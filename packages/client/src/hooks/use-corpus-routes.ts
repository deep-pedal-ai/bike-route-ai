import { useEffect, useState } from 'react';

import type { CorpusRoutesResponse } from '@bike-route-ai/shared';

type UseCorpusRoutesResult = {
  data: CorpusRoutesResponse | null;
  loading: boolean;
  error: Error | null;
};

export function useCorpusRoutes(region?: string): UseCorpusRoutesResult {
  const [data, setData] = useState<CorpusRoutesResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    const run = async (): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        // Scope the corpus to one region so a NY view never downloads (or fits
        // the camera to) another metro's geometry.
        const url =
          region === undefined
            ? '/api/corpus/routes'
            : `/api/corpus/routes?region=${encodeURIComponent(region)}`;
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) {
          throw new Error('Request failed with status ' + res.status);
        }
        const json: unknown = await res.json();
        if (controller.signal.aborted) return;
        setData(json as CorpusRoutesResponse);
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
  }, [region]);

  return { data, loading, error };
}
