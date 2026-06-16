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
      <div className="animate-fade-slide-up rounded-lg border border-[var(--color-bark-border)] bg-[var(--color-forest-panel)] p-6 text-center text-sm text-[var(--color-sage-text)]">
        No routes found in the corpus.
      </div>
    );
  }

  return (
    <div className="animate-fade-slide-up space-y-4">
      {filtersRelaxed && (
        <div className="flex items-start gap-3 rounded-lg border border-[var(--color-warning-border)] bg-[var(--color-warning-wash)] p-4 text-sm text-[var(--color-warning)]">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--color-warning)]" />
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
