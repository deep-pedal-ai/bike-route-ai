import { useState } from 'react';
import { Map, Source, Layer } from 'react-map-gl/maplibre';
import { useSearchParams } from 'react-router-dom';
import 'maplibre-gl/dist/maplibre-gl.css';

import FilterBar from '../components/FilterBar';
import Legend from '../components/Legend';
import RouteDetailPanel from '../components/RouteDetailPanel';
import { useCorpusRoutes } from '../hooks/use-corpus-routes';
import { useCorpusRoute } from '../hooks/use-corpus-route';
import { useFacilities } from '../hooks/use-facilities';
import { colorBySource, colorByQuality } from '../utils/route-color';
import { facilityColor } from '../utils/facility-color';
import { buildFilter } from '../utils/maplibre-filter';
import { fitBoundsFromFeatures } from '../utils/bounds';

import type { ExpressionSpecification } from 'maplibre-gl';
import type { FilterState } from '../utils/maplibre-filter';
import type {
  Bbox,
  CorpusRoutesResponse,
  FacilitiesResponse,
} from '@bike-route-ai/shared';

type ColorMode = 'source' | 'quality';
type MapView = {
  longitude: number;
  latitude: number;
  zoom: number;
};

const SOURCES = ['osm_relation', 'canon', 'generated', 'nysdot'] as const;
const FACILITY_CLASSES = ['protected', 'lane', 'sharrow', 'greenway', 'other'] as const;

// Sensible NY default centre used until routes load.
const NY_DEFAULT = { longitude: -73.95, latitude: 40.7, zoom: 10 };

const CARTO_DARK_MATTER =
  'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

const ATTRIBUTION =
  '© CARTO · © OpenStreetMap contributors, ODbL';

const EMPTY_ROUTES: CorpusRoutesResponse = {
  type: 'FeatureCollection',
  features: [],
};

const EMPTY_FACILITIES: FacilitiesResponse = {
  type: 'FeatureCollection',
  features: [],
  truncated: false,
  count: 0,
};

// --- Pure paint-expression builders (module scope so they stay referentially
// stable and don't capture component state). They lean entirely on the C3
// colour utils so the colour logic stays single-sourced. ---

// `['match', ['get','source'], 'osm_relation', <c>, …, <fallback>]`
function sourcePaintExpression(): ExpressionSpecification {
  const cases: string[] = [];
  for (const source of SOURCES) {
    cases.push(source, colorBySource(source));
  }
  // Fallback: colorBySource of an unmapped key yields the default colour.
  return [
    'match',
    ['get', 'source'],
    ...cases,
    colorBySource('__unknown__'),
  ] as unknown as ExpressionSpecification;
}

// `['interpolate', ['linear'], ['get','quality_score'], 0, <low>, 1, <high>]`
function qualityPaintExpression(): ExpressionSpecification {
  return [
    'interpolate',
    ['linear'],
    ['get', 'quality_score'],
    0,
    colorByQuality(0),
    1,
    colorByQuality(1),
  ] as unknown as ExpressionSpecification;
}

function lineColorFor(mode: ColorMode): ExpressionSpecification {
  return mode === 'source' ? sourcePaintExpression() : qualityPaintExpression();
}

// `['match', ['get','facility_class'], 'protected', <c>, …, <fallback>]`
function facilityPaintExpression(): ExpressionSpecification {
  return [
    'match',
    ['get', 'facility_class'],
    ...FACILITY_CLASSES.flatMap((cls) => [cls, facilityColor(cls)]),
    facilityColor('__unknown__'),
  ] as unknown as ExpressionSpecification;
}

function mercatorY(lat: number): number {
  const sin = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
}

function fitZoom(west: number, south: number, east: number, north: number): number {
  const tileSize = 512;
  const viewportWidth = Math.max(window.innerWidth - 240, 320);
  const viewportHeight = Math.max(window.innerHeight - 180, 320);
  const lonSpan = Math.max(east - west, 0.001);
  const mercatorSpan = Math.max(Math.abs(mercatorY(south) - mercatorY(north)), 0.00001);
  const zoomX = Math.log2((viewportWidth * 360) / (tileSize * lonSpan));
  const zoomY = Math.log2(viewportHeight / (tileSize * mercatorSpan));
  return Math.max(5, Math.min(10, Math.min(zoomX, zoomY)));
}

// Centre and zoom derived from route bounds; NY default while empty.
function viewFromRoutes(routes: CorpusRoutesResponse): MapView {
  if (routes.features.length === 0) {
    return NY_DEFAULT;
  }
  const [[west, south], [east, north]] = fitBoundsFromFeatures(routes);
  return {
    longitude: (west + east) / 2,
    latitude: (south + north) / 2,
    zoom: fitZoom(west, south, east, north),
  };
}

const SOURCE_SWATCHES = SOURCES.map((source) => ({
  label: source,
  color: colorBySource(source),
}));

const FACILITY_SWATCHES = FACILITY_CLASSES.map((cls) => ({
  label: cls,
  color: facilityColor(cls),
}));

const QUALITY_GRADIENT = { from: colorByQuality(0), to: colorByQuality(1) };

export default function MapExplorer() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [filterState, setFilterState] = useState<FilterState>({ sources: [] });
  const [colorMode, setColorMode] = useState<ColorMode>('source');
  const [overlayOn, setOverlayOn] = useState<boolean>(false);

  const {
    data: routesData,
    loading: routesLoading,
    error: routesError,
  } = useCorpusRoutes();
  const routes = routesData ?? EMPTY_ROUTES;

  const routeParam = searchParams.get('route');
  const selectedId = routeParam === null ? null : Number(routeParam);
  const {
    data: routeDetail,
    loading: routeLoading,
    error: routeError,
  } = useCorpusRoute(selectedId);

  // Static viewport bbox for the facility query. The mocked map never moves in
  // tests; in the app this is a reasonable NY-wide box.
  const viewportBbox: Bbox = [-74.3, 40.4, -73.6, 41.0];
  const {
    data: facilitiesData,
    loading: facilitiesLoading,
    error: facilitiesError,
  } = useFacilities(
    viewportBbox,
    [...FACILITY_CLASSES],
    overlayOn,
  );

  const view = viewFromRoutes(routes);

  const clearSelection = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('route');
    setSearchParams(next);
  };

  const selectRoute = (id: number) => {
    const next = new URLSearchParams(searchParams);
    next.set('route', String(id));
    setSearchParams(next);
  };

  return (
    <main className="relative h-[calc(100vh-4rem)] w-full overflow-hidden bg-zinc-950">
      <div className="map-panel absolute left-3 top-3 z-10 w-[min(27rem,calc(100vw-1.5rem))] rounded-lg border border-zinc-800/80 bg-zinc-950/88 p-3 shadow-[0_20px_70px_rgba(0,0,0,0.45)] backdrop-blur-md">
        <FilterBar
          value={filterState}
          colorMode={colorMode}
          onChange={setFilterState}
          onColorModeChange={setColorMode}
        />
        <label className="mt-3 flex items-center justify-between gap-3 rounded border border-zinc-800 bg-zinc-950/50 px-2 py-1.5 text-xs text-zinc-300">
          <span className="text-[11px] uppercase text-zinc-400">
            Facility overlay
          </span>
          <input
            type="checkbox"
            checked={overlayOn}
            onChange={(e) => setOverlayOn(e.target.checked)}
            className="h-4 w-4 accent-lime-300"
          />
        </label>
        <div className="mt-3">
          <Legend
            mode={colorMode}
            sourceSwatches={SOURCE_SWATCHES}
            qualityGradient={QUALITY_GRADIENT}
            facilitySwatches={FACILITY_SWATCHES}
            showFacilities={overlayOn}
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5 font-mono text-[10px] uppercase">
          {routesLoading && (
            <span className="rounded border border-sky-300/30 bg-sky-300/10 px-2 py-1 text-sky-200">
              Loading routes
            </span>
          )}
          {routesError !== null && (
            <span className="rounded border border-red-300/30 bg-red-300/10 px-2 py-1 text-red-200">
              Routes error
            </span>
          )}
          {!routesLoading && routesError === null && routes.features.length === 0 && (
            <span className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-400">
              No routes
            </span>
          )}
          {routeLoading && (
            <span className="rounded border border-lime-300/30 bg-lime-300/10 px-2 py-1 text-lime-200">
              Loading detail
            </span>
          )}
          {routeError !== null && (
            <span className="rounded border border-red-300/30 bg-red-300/10 px-2 py-1 text-red-200">
              Detail error
            </span>
          )}
          {facilitiesLoading && (
            <span className="rounded border border-cyan-300/30 bg-cyan-300/10 px-2 py-1 text-cyan-200">
              Loading facilities
            </span>
          )}
          {facilitiesError !== null && (
            <span className="rounded border border-red-300/30 bg-red-300/10 px-2 py-1 text-red-200">
              Facilities error
            </span>
          )}
        </div>
      </div>

      {routeDetail !== null && (
        <div className="absolute inset-x-3 bottom-3 z-20 sm:inset-x-auto sm:bottom-auto sm:right-3 sm:top-3 sm:w-96 sm:max-w-[36vw]">
          <RouteDetailPanel route={routeDetail} onClose={clearSelection} />
        </div>
      )}

      <Map
        key={`${view.longitude}:${view.latitude}:${view.zoom}`}
        initialViewState={view}
        mapStyle={CARTO_DARK_MATTER}
        interactiveLayerIds={['routes']}
        onClick={(event) => {
          const feature = event.features?.[0];
          const id = feature?.properties?.id;
          if (typeof id === 'number') {
            selectRoute(id);
          }
        }}
      >
        {/* Facility overlay renders UNDER the routes layer (rendered first). */}
        <Source
          id="facilities"
          type="geojson"
          data={facilitiesData ?? EMPTY_FACILITIES}
        >
          <Layer
            id="facilities"
            type="line"
            layout={{ visibility: overlayOn ? 'visible' : 'none' }}
            paint={{
              'line-color': facilityPaintExpression(),
              'line-opacity': 0.7,
              'line-width': 2,
            }}
          />
        </Source>

        <Source id="routes" type="geojson" data={routes}>
          <Layer
            id="routes-glow"
            type="line"
            paint={{
              'line-color': lineColorFor(colorMode),
              'line-blur': 2.5,
              'line-opacity': 0.32,
              'line-width': 8,
            }}
            filter={buildFilter(filterState)}
          />
          <Layer
            id="routes"
            type="line"
            paint={{
              'line-color': lineColorFor(colorMode),
              'line-opacity': 0.95,
              'line-width': 3,
            }}
            filter={buildFilter(filterState)}
          />
        </Source>
      </Map>

      <div className="pointer-events-none absolute bottom-1 right-1 z-10 rounded bg-zinc-900/80 px-2 py-0.5 text-[10px] text-zinc-400">
        {ATTRIBUTION}
      </div>
    </main>
  );
}
