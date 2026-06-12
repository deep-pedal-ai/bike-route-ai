import { AlertCircle } from 'lucide-react';
import RouteResultCard from './RouteResultCard';
import type { RouteSearchResult } from '@bike-route-ai/shared';

type RouteResultsProps = {
  results: RouteSearchResult[];
  filtersRelaxed: boolean;
};

export default function RouteResults({ results, filtersRelaxed }: RouteResultsProps) {
  if (results.length === 0) {
    return (
      <div className="animate-fade-slide-up rounded-lg border border-zinc-800 bg-zinc-900/60 p-6 text-center text-sm text-zinc-400">
        No routes found in the corpus.
      </div>
    );
  }

  return (
    <div className="animate-fade-slide-up space-y-4">
      {filtersRelaxed && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-300" />
          <p>No exact route satisfied those distance or loop filters. Closest corpus routes are shown.</p>
        </div>
      )}

      <div className="space-y-4">
        {results.map((result, index) => (
          <RouteResultCard key={result.id} result={result} rank={index + 1} />
        ))}
      </div>
    </div>
  );
}
