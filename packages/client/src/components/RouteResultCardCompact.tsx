import { MapPinOff, Repeat2 } from 'lucide-react';
import {
  DIFFICULTY_STYLES,
  deriveDifficulty,
  formatDistance,
  formatQuality,
} from './RouteResultCard';
import type { RouteSearchResult } from '@bike-route-ai/shared';

type RouteResultCardCompactProps = {
  result: RouteSearchResult;
  rank: number;
  /** No geometry on the map — shown for context, dimmed and non-interactive. */
  unmappable?: boolean;
};

// Condensed card for the mobile bottom dock's peek carousel. Reuses the desktop
// card's formatting helpers so the numbers never diverge; drops the blurb and
// surface bar to fit a ~32dvh peek. Sized to fill its carousel slot (w-full).
export default function RouteResultCardCompact({
  result,
  rank,
  unmappable = false,
}: RouteResultCardCompactProps) {
  const difficulty = deriveDifficulty(result);

  return (
    <article className="flex h-full w-full flex-col gap-2.5 rounded-xl border border-[var(--color-bark-border)] bg-[var(--color-forest-panel)] p-4 text-left shadow-lg shadow-black/15">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center rounded-full border border-[var(--color-leaf-border)] bg-[var(--color-leaf-wash)] px-2 py-0.5 text-xs font-semibold text-[var(--color-leaf)]">
          #{rank}
        </span>
        <span
          className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${DIFFICULTY_STYLES[difficulty]}`}
        >
          {difficulty}
        </span>
        {unmappable && (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-[var(--color-bark-border)] bg-[var(--color-bark)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-sage-text)]">
            <MapPinOff className="h-3 w-3" />
            No preview
          </span>
        )}
      </div>

      <h3 className="line-clamp-2 text-base font-bold leading-snug text-[var(--color-cream)]">
        {result.name}
      </h3>

      <dl className="mt-auto flex items-center gap-4 text-sm text-[var(--color-sage-text)]">
        <div className="min-w-0">
          <dt className="text-[10px] uppercase tracking-wide text-[var(--color-moss-muted)]">
            Distance
          </dt>
          <dd className="truncate font-semibold text-[var(--color-cream)]">
            {formatDistance(result.distanceKm)}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-[var(--color-moss-muted)]">
            Quality
          </dt>
          <dd className="font-semibold text-[var(--color-cream)]">
            {formatQuality(result.qualityScore)}
          </dd>
        </div>
        <div className="ml-auto inline-flex items-center gap-1 text-xs text-[var(--color-sage-text)]">
          <Repeat2 className="h-3.5 w-3.5" />
          {result.isLoop ? 'Loop' : 'Point-to-point'}
        </div>
      </dl>
    </article>
  );
}
