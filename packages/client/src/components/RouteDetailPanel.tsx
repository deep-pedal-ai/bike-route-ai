import { CORPUS_FIELD_DOCS } from '../corpus-field-docs';
import type { Feature, LineString } from 'geojson';
import type { CorpusRouteDetailProps } from '@bike-route-ai/shared';

type RouteDetailPanelProps = {
  route: Feature<LineString, CorpusRouteDetailProps> | null;
  onClose: () => void;
};

export default function RouteDetailPanel({ route, onClose }: RouteDetailPanelProps) {
  if (route === null) {
    return null;
  }

  const p = route.properties;

  return (
    <aside className="space-y-4 rounded-lg border border-zinc-700/60 bg-zinc-900 p-4 text-zinc-200">
      <header className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-semibold">{p.name ?? 'Unnamed route'}</h2>
        <button
          type="button"
          aria-label="Close route detail"
          onClick={onClose}
          className="rounded px-2 py-1 text-zinc-400 hover:text-zinc-100"
        >
          ×
        </button>
      </header>

      <span
        title={CORPUS_FIELD_DOCS.source}
        className="inline-block rounded-full bg-zinc-800 px-2 py-0.5 text-xs font-semibold text-lime-400"
      >
        {p.source}
      </span>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt title={CORPUS_FIELD_DOCS.distance_km} className="text-xs text-zinc-400">
            Distance (km)
          </dt>
          <dd>{p.distance_km ?? '—'}</dd>
        </div>
        <div>
          <dt title={CORPUS_FIELD_DOCS.is_loop} className="text-xs text-zinc-400">
            Loop
          </dt>
          <dd>{p.is_loop === null ? '—' : p.is_loop ? 'Yes' : 'No'}</dd>
        </div>
        <div>
          <dt title={CORPUS_FIELD_DOCS.ascent_m} className="text-xs text-zinc-400">
            Ascent (m)
          </dt>
          <dd>{p.ascent_m ?? '—'}</dd>
        </div>
        <div>
          <dt title={CORPUS_FIELD_DOCS.descent_m} className="text-xs text-zinc-400">
            Descent (m)
          </dt>
          <dd>{p.descent_m ?? '—'}</dd>
        </div>
        <div>
          <dt title={CORPUS_FIELD_DOCS.quality_score} className="text-xs text-zinc-400">
            Quality score
          </dt>
          <dd>{p.quality_score ?? '—'}</dd>
        </div>
        <div>
          <dt title={CORPUS_FIELD_DOCS.match_quality} className="text-xs text-zinc-400">
            Match quality
          </dt>
          <dd>{p.match_quality ?? '—'}</dd>
        </div>
        <div>
          <dt
            title={CORPUS_FIELD_DOCS.protected_lane_fraction}
            className="text-xs text-zinc-400"
          >
            Protected lane
          </dt>
          <dd>{p.protected_lane_fraction ?? '—'}</dd>
        </div>
        <div>
          <dt
            title={CORPUS_FIELD_DOCS.greenway_fraction}
            className="text-xs text-zinc-400"
          >
            Greenway
          </dt>
          <dd>{p.greenway_fraction ?? '—'}</dd>
        </div>
        <div>
          <dt
            title={CORPUS_FIELD_DOCS.facility_coverage_fraction}
            className="text-xs text-zinc-400"
          >
            Facility coverage
          </dt>
          <dd>{p.facility_coverage_fraction ?? '—'}</dd>
        </div>
      </dl>

      <section className="space-y-1.5">
        <h3 title={CORPUS_FIELD_DOCS.surface_breakdown} className="text-xs text-zinc-400">
          Surface
        </h3>
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-zinc-800">
          {Object.entries(p.surface_breakdown ?? {}).map(([surface, fraction]) => (
            <div
              key={surface}
              data-testid="surface-segment"
              title={`${surface} ${Math.round(fraction * 100)}%`}
              className="h-full bg-lime-400/80"
              style={{ width: `${fraction * 100}%` }}
            />
          ))}
        </div>
      </section>

      {p.attribution !== null && (
        <p
          title={CORPUS_FIELD_DOCS.attribution}
          className="text-[11px] leading-snug text-zinc-500"
        >
          {p.attribution}
        </p>
      )}
    </aside>
  );
}
