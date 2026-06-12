import { CORPUS_FIELD_DOCS } from '../corpus-field-docs';
import type { Feature, LineString } from 'geojson';
import type { CorpusRouteDetailProps } from '@bike-route-ai/shared';

type RouteDetailPanelProps = {
  route: Feature<LineString, CorpusRouteDetailProps> | null;
  onClose: () => void;
};

function formatNumber(value: number | null, digits = 1): string {
  if (value === null) {
    return '—';
  }
  return value.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function formatFraction(value: number | null): string {
  if (value === null) {
    return '—';
  }
  return Math.round(value * 100) + '%';
}

export default function RouteDetailPanel({ route, onClose }: RouteDetailPanelProps) {
  if (route === null) {
    return null;
  }

  const p = route.properties;

  return (
    <aside className="detail-panel-motion max-h-[70vh] space-y-4 overflow-auto rounded-lg border border-lime-300/20 bg-zinc-950/95 p-4 text-zinc-200 shadow-[0_0_40px_rgba(0,0,0,0.55)] backdrop-blur-md">
      <header className="flex items-start justify-between gap-3">
        <h2 className="text-balance text-lg font-semibold leading-tight text-zinc-50">
          {p.name ?? 'Unnamed route'}
        </h2>
        <button
          type="button"
          aria-label="Close route detail"
          onClick={onClose}
          className="h-8 w-8 rounded border border-zinc-800 text-zinc-500 transition hover:border-lime-300 hover:text-lime-200"
        >
          ×
        </button>
      </header>

      <span
        title={CORPUS_FIELD_DOCS.source}
        className="inline-block rounded-full border border-lime-300/30 bg-lime-300/10 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase text-lime-300"
      >
        {p.source}
      </span>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt title={CORPUS_FIELD_DOCS.distance_km} className="text-xs text-zinc-400">
            Distance (km)
          </dt>
          <dd className="font-mono text-zinc-50">{formatNumber(p.distance_km, 1)}</dd>
        </div>
        <div>
          <dt title={CORPUS_FIELD_DOCS.is_loop} className="text-xs text-zinc-400">
            Loop
          </dt>
          <dd className="font-mono text-zinc-50">
            {p.is_loop === null ? '—' : p.is_loop ? 'YES' : 'NO'}
          </dd>
        </div>
        <div>
          <dt title={CORPUS_FIELD_DOCS.ascent_m} className="text-xs text-zinc-400">
            Ascent (m)
          </dt>
          <dd className="font-mono text-zinc-50">{formatNumber(p.ascent_m, 0)}</dd>
        </div>
        <div>
          <dt title={CORPUS_FIELD_DOCS.descent_m} className="text-xs text-zinc-400">
            Descent (m)
          </dt>
          <dd className="font-mono text-zinc-50">{formatNumber(p.descent_m, 0)}</dd>
        </div>
        <div>
          <dt title={CORPUS_FIELD_DOCS.quality_score} className="text-xs text-zinc-400">
            Quality score
          </dt>
          <dd className="font-mono text-zinc-50">{formatNumber(p.quality_score, 2)}</dd>
        </div>
        <div>
          <dt title={CORPUS_FIELD_DOCS.match_quality} className="text-xs text-zinc-400">
            Match quality
          </dt>
          <dd className="font-mono text-zinc-50">{formatNumber(p.match_quality, 2)}</dd>
        </div>
        <div>
          <dt
            title={CORPUS_FIELD_DOCS.protected_lane_fraction}
            className="text-xs text-zinc-400"
          >
            Protected lane
          </dt>
          <dd className="font-mono text-zinc-50">
            {formatFraction(p.protected_lane_fraction)}
          </dd>
        </div>
        <div>
          <dt
            title={CORPUS_FIELD_DOCS.greenway_fraction}
            className="text-xs text-zinc-400"
          >
            Greenway
          </dt>
          <dd className="font-mono text-zinc-50">{formatFraction(p.greenway_fraction)}</dd>
        </div>
        <div>
          <dt
            title={CORPUS_FIELD_DOCS.facility_coverage_fraction}
            className="text-xs text-zinc-400"
          >
            Facility coverage
          </dt>
          <dd className="font-mono text-zinc-50">
            {formatFraction(p.facility_coverage_fraction)}
          </dd>
        </div>
      </dl>

      <section className="space-y-1.5">
        <h3 title={CORPUS_FIELD_DOCS.surface_breakdown} className="text-xs text-zinc-400">
          Surface
        </h3>
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-zinc-800">
          {Object.entries(p.surface_breakdown ?? {}).map(([surface, fraction], index) => (
            <div
              key={surface}
              data-testid="surface-segment"
              title={`${surface} ${Math.round(fraction * 100)}%`}
              className={[
                'h-full',
                index % 2 === 0 ? 'bg-lime-300/90' : 'bg-sky-300/80',
              ].join(' ')}
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
