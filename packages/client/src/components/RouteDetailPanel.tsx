import { Coffee, Droplets, Mountain, Landmark, Bike } from 'lucide-react';

import { CORPUS_FIELD_DOCS } from '../corpus-field-docs';
import { poiColor } from '../utils/poi-color';
import type { Feature, LineString } from 'geojson';
import type {
  CorpusRouteDetailProps,
  PoiBucket,
  PoiSummary,
} from '@bike-route-ai/shared';
import type { LucideIcon } from 'lucide-react';

// Per-bucket icon + label. The icon system (colour from poiColor + shape here)
// carries the visual richness since most POIs have no image (feature doc §2a).
// Ordered list keeps the grouped sections stable and matches the map layer.
const POI_BUCKET_META: { bucket: PoiBucket; label: string; Icon: LucideIcon }[] = [
  { bucket: 'coffee_food', label: 'Coffee & food', Icon: Coffee },
  { bucket: 'water_rest', label: 'Water & rest', Icon: Droplets },
  { bucket: 'scenic', label: 'Scenic', Icon: Mountain },
  { bucket: 'landmark', label: 'Landmark', Icon: Landmark },
  { bucket: 'bike_services', label: 'Bike services', Icon: Bike },
];

// Google Maps deep-link, derived from geometry — never stored (feature doc §5).
// query is LAT,LNG (the reverse of GeoJSON's [lng,lat] geometry order).
function googleMapsHref(poi: PoiSummary): string {
  return `https://www.google.com/maps/search/?api=1&query=${poi.lat},${poi.lng}`;
}

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
    <aside className="detail-panel-motion max-h-[70vh] space-y-4 overflow-auto rounded-lg border border-[var(--color-bark-border)] bg-[var(--color-forest-panel)] p-4 text-[var(--color-cream)] shadow-[0_24px_50px_rgba(16,20,15,0.55)] backdrop-blur-md">
      <header className="flex items-start justify-between gap-3">
        <h2 className="text-balance text-lg font-semibold leading-tight text-[var(--color-cream)]">
          {p.name ?? 'Unnamed route'}
        </h2>
        <button
          type="button"
          aria-label="Close route detail"
          onClick={onClose}
          className="h-8 w-8 rounded border border-[var(--color-bark-border)] text-[var(--color-moss-muted)] transition hover:border-[var(--color-leaf)] hover:text-[var(--color-cream)]"
        >
          ×
        </button>
      </header>

      <span
        title={CORPUS_FIELD_DOCS.source}
        className="inline-block rounded-full border border-[var(--color-leaf-border)] bg-[var(--color-leaf-wash)] px-2 py-0.5 font-mono text-[10px] font-semibold uppercase text-[var(--color-leaf)]"
      >
        {p.source}
      </span>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt title={CORPUS_FIELD_DOCS.distance_km} className="text-xs text-[var(--color-sage-text)]">
            Distance (km)
          </dt>
          <dd className="font-mono text-[var(--color-cream)]">{formatNumber(p.distance_km, 1)}</dd>
        </div>
        <div>
          <dt title={CORPUS_FIELD_DOCS.is_loop} className="text-xs text-[var(--color-sage-text)]">
            Loop
          </dt>
          <dd className="font-mono text-[var(--color-cream)]">
            {p.is_loop === null ? '—' : p.is_loop ? 'YES' : 'NO'}
          </dd>
        </div>
        <div>
          <dt title={CORPUS_FIELD_DOCS.ascent_m} className="text-xs text-[var(--color-sage-text)]">
            Ascent (m)
          </dt>
          <dd className="font-mono text-[var(--color-cream)]">{formatNumber(p.ascent_m, 0)}</dd>
        </div>
        <div>
          <dt title={CORPUS_FIELD_DOCS.descent_m} className="text-xs text-[var(--color-sage-text)]">
            Descent (m)
          </dt>
          <dd className="font-mono text-[var(--color-cream)]">{formatNumber(p.descent_m, 0)}</dd>
        </div>
        <div>
          <dt title={CORPUS_FIELD_DOCS.quality_score} className="text-xs text-[var(--color-sage-text)]">
            Quality score
          </dt>
          <dd className="font-mono text-[var(--color-cream)]">{formatNumber(p.quality_score, 2)}</dd>
        </div>
        <div>
          <dt title={CORPUS_FIELD_DOCS.match_quality} className="text-xs text-[var(--color-sage-text)]">
            Match quality
          </dt>
          <dd className="font-mono text-[var(--color-cream)]">{formatNumber(p.match_quality, 2)}</dd>
        </div>
        <div>
          <dt
            title={CORPUS_FIELD_DOCS.protected_lane_fraction}
            className="text-xs text-[var(--color-sage-text)]"
          >
            Protected lane
          </dt>
          <dd className="font-mono text-[var(--color-cream)]">
            {formatFraction(p.protected_lane_fraction)}
          </dd>
        </div>
        <div>
          <dt
            title={CORPUS_FIELD_DOCS.greenway_fraction}
            className="text-xs text-[var(--color-sage-text)]"
          >
            Greenway
          </dt>
          <dd className="font-mono text-[var(--color-cream)]">{formatFraction(p.greenway_fraction)}</dd>
        </div>
        <div>
          <dt
            title={CORPUS_FIELD_DOCS.facility_coverage_fraction}
            className="text-xs text-[var(--color-sage-text)]"
          >
            Facility coverage
          </dt>
          <dd className="font-mono text-[var(--color-cream)]">
            {formatFraction(p.facility_coverage_fraction)}
          </dd>
        </div>
      </dl>

      <section className="space-y-1.5">
        <h3 title={CORPUS_FIELD_DOCS.surface_breakdown} className="text-xs text-[var(--color-sage-text)]">
          Surface
        </h3>
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-[var(--color-bark-soft)]">
          {Object.entries(p.surface_breakdown ?? {}).map(([surface, fraction], index) => (
            <div
              key={surface}
              data-testid="surface-segment"
              title={`${surface} ${Math.round(fraction * 100)}%`}
              className={[
                'h-full',
                index % 2 === 0 ? 'bg-[var(--color-leaf)]' : 'bg-[var(--color-river)]',
              ].join(' ')}
              style={{ width: `${fraction * 100}%` }}
            />
          ))}
        </div>
      </section>

      {p.pois !== undefined && p.pois.length > 0 && (
        <section data-testid="poi-section" className="space-y-3">
          <h3
            title={CORPUS_FIELD_DOCS.pois}
            className="text-xs text-[var(--color-sage-text)]"
          >
            Nearby
          </h3>
          {POI_BUCKET_META.map(({ bucket, label, Icon }) => {
            const inBucket = p.pois!.filter((poi) => poi.bucket === bucket);
            if (inBucket.length === 0) {
              return null;
            }
            const color = poiColor(bucket);
            return (
              <div key={bucket} className="space-y-1.5">
                <h4 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase text-[var(--color-moss-muted)]">
                  <Icon className="h-3.5 w-3.5" style={{ color }} aria-hidden="true" />
                  {label}
                </h4>
                <ul className="space-y-1.5">
                  {inBucket.map((poi) => (
                    <li
                      key={poi.id}
                      className="rounded border border-[var(--color-bark-border)] bg-[var(--color-bark-soft)] p-2"
                    >
                      <div className="flex items-start gap-2">
                        <span
                          aria-hidden="true"
                          className="mt-0.5 inline-flex h-5 w-5 flex-none items-center justify-center rounded-full"
                          style={{ backgroundColor: color }}
                        >
                          <Icon className="h-3 w-3 text-[var(--color-cream)]" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-sm text-[var(--color-cream)]">
                              {poi.name ?? 'Unnamed'}
                            </span>
                            <span className="flex-none font-mono text-xs text-[var(--color-sage-text)]">
                              {Math.round(poi.distance_m)} m
                            </span>
                          </div>
                          {poi.image_url !== null && (
                            <figure className="mt-1.5 space-y-1">
                              <img
                                src={poi.image_url}
                                alt={poi.name ?? 'Point of interest'}
                                loading="lazy"
                                className="h-24 w-full rounded object-cover"
                              />
                              {poi.image_attribution !== null && (
                                <figcaption className="text-[10px] leading-snug text-[var(--color-moss-muted)]">
                                  {poi.image_attribution}
                                </figcaption>
                              )}
                            </figure>
                          )}
                          <a
                            href={googleMapsHref(poi)}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 inline-block text-xs text-[var(--color-leaf)] underline-offset-2 hover:underline"
                          >
                            View on Google Maps
                          </a>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </section>
      )}

      {p.attribution !== null && (
        <p
          title={CORPUS_FIELD_DOCS.attribution}
          className="text-[11px] leading-snug text-[var(--color-moss-muted)]"
        >
          {p.attribution}
        </p>
      )}
    </aside>
  );
}
