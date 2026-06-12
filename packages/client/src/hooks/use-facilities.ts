import { useEffect, useState } from 'react';

import type { Bbox, FacilitiesResponse } from '@bike-route-ai/shared';

type UseFacilitiesResult = {
  data: FacilitiesResponse | null;
  loading: boolean;
  error: Error | null;
};

const DEBOUNCE_MS = 300;

export function useFacilities(
  bbox: Bbox | null,
  classes: string[] | undefined,
  enabled: boolean,
): UseFacilitiesResult {
  const [data, setData] = useState<FacilitiesResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  const bboxKey = bbox ? bbox.join(',') : null;
  const classesKey = classes && classes.length > 0 ? classes.join(',') : null;

  useEffect(() => {
    if (!enabled || bboxKey === null) {
      return;
    }

    const controller = new AbortController();

    let url = '/api/corpus/facilities?bbox=' + bboxKey;
    if (classesKey !== null) {
      url += '&classes=' + classesKey;
    }

    const run = async (): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) {
          throw new Error('Request failed with status ' + res.status);
        }
        const json: unknown = await res.json();
        if (controller.signal.aborted) return;
        setData(json as FacilitiesResponse);
        setLoading(false);
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err : new Error('Unknown error'));
        setLoading(false);
      }
    };

    const timer = setTimeout(() => {
      void run();
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [bboxKey, classesKey, enabled]);

  return { data, loading, error };
}
