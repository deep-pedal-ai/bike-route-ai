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

  const { data: routesData } = useCorpusRoutes();
  const routes = routesData ?? EMPTY_ROUTES;

  const routeParam = searchParams.get('route');
  const selectedId = routeParam === null ? null : Number(routeParam);
  const { data: routeDetail } = useCorpusRoute(selectedId);

  // Static viewport bbox for the facility query. The mocked map never moves in
  // tests; in the app this is a reasonable NY-wide box.
  const viewportBbox: Bbox = [-74.3, 40.4, -73.6, 41.0];
  const { data: facilitiesData } = useFacilities(
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
    <main className="relative h-[calc(100vh-4rem)] w-full">
      <div className="absolute left-3 top-3 z-10 max-w-md rounded-lg bg-zinc-900/90 p-3">
        <FilterBar
          value={filterState}
          colorMode={colorMode}
          onChange={setFilterState}
          onColorModeChange={setColorMode}
        />
        <label className="mt-2 flex items-center gap-2 text-xs text-zinc-300">
          <input
            type="checkbox"
            checked={overlayOn}
            onChange={(e) => setOverlayOn(e.target.checked)}
          />
          Facility overlay
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
      </div>

      {routeDetail !== null && (
        <div className="absolute right-3 top-3 z-10 w-80 max-w-[90vw]">
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
              'line-width': 2,
            }}
          />
        </Source>

        <Source id="routes" type="geojson" data={routes}>
          <Layer
            id="routes"
            type="line"
            paint={{
              'line-color': lineColorFor(colorMode),
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
