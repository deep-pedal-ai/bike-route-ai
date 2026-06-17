import { Award, BadgeCheck, Map, Repeat2, Route, TrendingUp } from 'lucide-react';
import SurfaceBar from './SurfaceBar';
import type { RouteSearchResult } from '@bike-route-ai/shared';
import type { Difficulty, Surface } from '../types/route';

type RouteResultCardProps = {
  result: RouteSearchResult;
  rank: number;
};

export const DIFFICULTY_STYLES: Record<Difficulty, string> = {
  Easy: 'border-[var(--color-leaf-border)] bg-[var(--color-leaf-wash)] text-[var(--color-leaf)]',
  Moderate: 'border-[var(--color-river)] bg-[var(--color-sky-wash)] text-[var(--color-river)]',
  Hard: 'border-[var(--color-warning-border)] bg-[var(--color-warning-wash)] text-[var(--color-warning)]',
  Epic: 'border-[var(--color-danger-border)] bg-[var(--color-danger-wash)] text-[var(--color-danger)]',
};

export default function RouteResultCard({ result, rank }: RouteResultCardProps) {
  const difficulty = deriveDifficulty(result);
  const surfaces = toSurfaces(result.surfaceBreakdown);

  return (
    <article className="rounded-lg border border-[var(--color-bark-border)] bg-[var(--color-forest-panel)] p-5 shadow-lg shadow-black/15">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-leaf-border)] bg-[var(--color-leaf-wash)] px-2.5 py-1 text-xs font-semibold text-[var(--color-leaf)]">
              <BadgeCheck className="h-3.5 w-3.5" />
              #{rank}
            </span>
            <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${DIFFICULTY_STYLES[difficulty]}`}>
              {difficulty}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-bark-border)] bg-[var(--color-bark-soft)] px-2.5 py-1 text-xs font-medium text-[var(--color-sage-text)]">
              <Repeat2 className="h-3.5 w-3.5" />
              {result.isLoop ? 'Loop' : 'Not a loop'}
            </span>
          </div>

          <h2 className="text-xl font-bold tracking-tight text-[var(--color-ink)] sm:text-2xl">{result.name}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--color-sage-text)]">{result.blurb}</p>
        </div>

        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg border border-[var(--color-leaf-border)] bg-[var(--color-leaf-wash)]">
          <Route className="h-6 w-6 text-[var(--color-leaf)]" />
        </div>
      </div>

      <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-3">
        <div className="flex items-center gap-2 text-[var(--color-sage-text)]">
          <Map className="h-4 w-4 text-[var(--color-leaf)]" />
          <div>
            <dt className="text-xs text-[var(--color-moss-muted)]">Distance</dt>
            <dd className="font-semibold">{formatDistance(result.distanceKm)}</dd>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[var(--color-sage-text)]">
          <TrendingUp className="h-4 w-4 text-[var(--color-leaf)]" />
          <div>
            <dt className="text-xs text-[var(--color-moss-muted)]">Elevation</dt>
            <dd className="font-semibold">{formatAscent(result.ascentM)}</dd>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[var(--color-sage-text)]">
          <Award className="h-4 w-4 text-[var(--color-leaf)]" />
          <div>
            <dt className="text-xs text-[var(--color-moss-muted)]">Quality</dt>
            <dd className="font-semibold">{formatQuality(result.qualityScore)}</dd>
          </div>
        </div>
      </dl>

      <div className="mt-5 border-t border-[var(--color-bark-border)] pt-4">
        <SurfaceBar surfaces={surfaces} />
      </div>
    </article>
  );
}

export function deriveDifficulty(result: RouteSearchResult): Difficulty {
  const ascentPerKm = result.ascentM === null ? 0 : result.ascentM / Math.max(result.distanceKm, 1);

  if (result.distanceKm >= 90 || ascentPerKm >= 24) return 'Epic';
  if (result.distanceKm >= 55 || ascentPerKm >= 16) return 'Hard';
  if (result.distanceKm >= 25 || ascentPerKm >= 8) return 'Moderate';
  return 'Easy';
}

function toSurfaces(surfaceBreakdown: Record<string, number> | null): Surface[] {
  if (!surfaceBreakdown) return [];

  const entries = Object.entries(surfaceBreakdown)
    .filter(([, value]) => Number.isFinite(value) && value > 0)
    .sort(([, a], [, b]) => b - a);

  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  if (total <= 0) return [];

  return entries.map(([label, value]) => ({
    label: formatSurfaceLabel(label),
    percentage: Math.round(toPercentage(value, total)),
  }));
}

function toPercentage(value: number, total: number): number {
  if (total <= 1.01) return value * 100;
  if (total > 100.5) return (value / total) * 100;
  return value;
}

function formatSurfaceLabel(label: string): string {
  return label
    .replace(/[_-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(' ');
}

export function formatDistance(distanceKm: number): string {
  const miles = distanceKm * 0.621371;
  const formattedMiles = miles >= 10 ? Math.round(miles).toString() : miles.toFixed(1);
  return `${formattedMiles} mi / ${distanceKm.toFixed(1)} km`;
}

function formatAscent(ascentM: number | null): string {
  if (ascentM === null) return 'No data';
  const feet = Math.round(ascentM * 3.28084);
  return `${feet.toLocaleString()} ft`;
}

export function formatQuality(qualityScore: number | null): string {
  if (qualityScore === null) return 'Unrated';
  const normalizedScore = qualityScore <= 1 ? qualityScore * 100 : qualityScore;
  return `${Math.round(normalizedScore)}%`;
}
