import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Map, Source, Layer } from 'react-map-gl/maplibre';
import { useSearchParams } from 'react-router-dom';
import 'maplibre-gl/dist/maplibre-gl.css';

import FilterBar from '../components/FilterBar';
import Legend from '../components/Legend';
import RouteDetailPanel from '../components/RouteDetailPanel';
import SearchBar from '../components/SearchBar';
import SearchResultsPanel from '../components/SearchResultsPanel';
import { useCorpusRoutes } from '../hooks/use-corpus-routes';
import { useCorpusRoute } from '../hooks/use-corpus-route';
import { useFacilities } from '../hooks/use-facilities';
import { useRouteSearch } from '../hooks/use-route-search';
import { colorBySource, colorByQuality } from '../utils/route-color';
import { facilityColor } from '../utils/facility-color';
import { buildFilter, buildIdFilter } from '../utils/maplibre-filter';
import { fitBoundsFromFeatures } from '../utils/bounds';
import {
  boundsForRouteId,
  routeOpacityExpression,
  CASING_FULL_OPACITY,
  CASING_DIM_OPACITY,
} from '../utils/route-search-view';

import type { MapRef } from 'react-map-gl/maplibre';
import type { ExpressionSpecification } from 'maplibre-gl';
import type { FilterState } from '../utils/maplibre-filter';
import type {
  Bbox,
  CorpusRoutesResponse,
  FacilitiesResponse,
  RouteSearchResult,
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

  // Natural-language route search (shared with the Generate page). Id of the
  // result route the user is pointing at (string-normalized) drives the routes
  // layer's line-opacity: hovered route bright, others dimmed (D4).
  const search = useRouteSearch();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // Wraps the floating SearchBar so focus can return to it when the panel closes.
  const searchFieldRef = useRef<HTMLDivElement>(null);

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

  // --- Imperative camera. The old `<Map key=…>` remount threw the camera away
  // on every view change and could not animate. We hold a ref to the map and
  // drive it directly via fitBounds. `initialViewState` still seeds the first
  // paint (and is the fitted view in tests), but once the map is loaded the
  // camera is ours to move. ---
  const mapRef = useRef<MapRef>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const didInitialFitRef = useRef(false);

  // Animate the camera to frame `bounds`. Dormant infrastructure for the search
  // feature (hover/click zoom land in later phases); the initial fit-to-all is
  // its first caller so the wiring is exercised, not dead.
  const focusBounds = useCallback(
    (
      bounds: [[number, number], [number, number]],
      opts?: { duration?: number; maxZoom?: number },
    ) => {
      mapRef.current?.fitBounds(bounds, {
        padding: 64,
        duration: 600,
        maxZoom: 15,
        ...opts,
      });
    },
    [],
  );

  // Frame all routes once, when both the map and the route data are ready. This
  // preserves the old remount's fit-to-all (instant, `duration: 0`) while the
  // ref-based camera handles everything after. `maxZoom: 10` mirrors the old
  // `fitZoom` cap so a tight corpus doesn't over-zoom the initial view.
  useEffect(() => {
    if (didInitialFitRef.current || !mapLoaded || routes.features.length === 0) {
      return;
    }
    focusBounds(fitBoundsFromFeatures(routes), { duration: 0, maxZoom: 10 });
    didInitialFitRef.current = true;
  }, [mapLoaded, routes, focusBounds]);

  // --- Search-driven view state. The plan's §4 three flags, tracked separately
  // so the panel can host its loading / error states while `results` is null. ---
  const panelOpen =
    search.isLoading || search.results !== null || search.error !== null;
  // While results exist, the id-membership filter supersedes the FilterBar (D3);
  // otherwise the FilterBar's filter rules. Both layers share this expression.
  const layerFilter =
    search.results !== null
      ? buildIdFilter(search.results.map((r) => String(r.id)))
      : buildFilter(filterState);
  // Ids of every route with geometry on the map; a result is "mappable" iff its
  // id is in this set (search can return metadata-only routes — D6).
  const loadedRouteIds = useMemo(
    () => new Set(routes.features.map((f) => String(f.properties.id))),
    [routes],
  );

  // When results arrive, frame the union of the mappable result geometries —
  // the filtered-in routes are otherwise off-screen and hover-highlight has
  // nothing visible to act on (plan §5.3). Mark as fitted only on a successful
  // fit, so a results-before-routes ordering still fits once the corpus loads;
  // skip entirely when nothing is mappable.
  const fittedResultsRef = useRef<RouteSearchResult[] | null>(null);
  useEffect(() => {
    if (search.results === fittedResultsRef.current) return;
    if (search.results === null) {
      fittedResultsRef.current = null;
      return;
    }
    const ids = new Set(search.results.map((r) => String(r.id)));
    const mappable = routes.features.filter((f) =>
      ids.has(String(f.properties.id)),
    );
    if (mappable.length === 0) return;
    fittedResultsRef.current = search.results;
    focusBounds(fitBoundsFromFeatures({ type: 'FeatureCollection', features: mappable }));
  }, [search.results, routes, focusBounds]);

  const clearSelection = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('route');
    setSearchParams(next);
  };

  const selectRoute = (id: string | number) => {
    const next = new URLSearchParams(searchParams);
    next.set('route', String(id));
    setSearchParams(next);
  };

  // Click a mappable result card → animate to frame it + open its detail panel
  // (D5). The null guard is belt-and-braces: no-geometry cards aren't clickable.
  const handleSelectResult = (id: string) => {
    const bounds = boundsForRouteId(routes, id);
    if (bounds === null) return;
    focusBounds(bounds);
    selectRoute(id);
  };

  // Close the panel → clear the search and the hover, restoring the FilterBar,
  // every path, and the full filter (D8), and return focus to the search field.
  const handleCloseSearch = () => {
    search.clear();
    setHoveredId(null);
    searchFieldRef.current?.querySelector('textarea')?.focus();
  };

  // Esc closes the panel from anywhere. A "latest ref" keeps the listener stable
  // so it subscribes once per open/close, not on every keystroke, while always
  // calling the current close handler.
  const closeSearchRef = useRef(handleCloseSearch);
  useEffect(() => {
    closeSearchRef.current = handleCloseSearch;
  });
  useEffect(() => {
    if (!panelOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeSearchRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [panelOpen]);

  return (
    <main className="relative h-[calc(100vh-4rem)] w-full overflow-hidden bg-[var(--color-forest)]">
      {/* Floating natural-language search — top-center, always reachable
          (z-40 keeps it above both side panels on every breakpoint). */}
      <div
        ref={searchFieldRef}
        role="search"
        aria-label="Search routes"
        className="absolute left-1/2 top-3 z-40 w-[min(32rem,calc(100vw-1.5rem))] -translate-x-1/2"
      >
        <SearchBar
          query={search.query}
          onQueryChange={search.setQuery}
          onGenerate={() => search.search(search.query)}
          isLoading={search.isLoading}
        />
      </div>

      {panelOpen && (
        <SearchResultsPanel
          results={search.results}
          mappableIds={loadedRouteIds}
          selectedId={routeParam}
          filtersRelaxed={search.filtersRelaxed}
          isLoading={search.isLoading}
          error={search.error}
          onHover={setHoveredId}
          onSelect={handleSelectResult}
          onClose={handleCloseSearch}
        />
      )}

      {/* FilterBar / Legend — hidden while the search panel is open (D1). */}
      {!panelOpen && (
      <div className="map-panel absolute left-3 top-48 z-10 w-[min(27rem,calc(100vw-1.5rem))] rounded-lg border border-[var(--color-bark-border)] bg-[var(--color-forest-panel)] p-3 shadow-[0_20px_55px_rgba(16,20,15,0.42)] backdrop-blur-md">
        <FilterBar
          value={filterState}
          colorMode={colorMode}
          onChange={setFilterState}
          onColorModeChange={setColorMode}
        />
        <label className="mt-3 flex items-center justify-between gap-3 rounded border border-[var(--color-bark-border)] bg-[var(--color-bark-soft)] px-2 py-1.5 text-xs text-[var(--color-sage-text)]">
          <span className="text-[11px] uppercase text-[var(--color-sage-text)]">
            Facility overlay
          </span>
          <input
            type="checkbox"
            checked={overlayOn}
            onChange={(e) => setOverlayOn(e.target.checked)}
            className="h-4 w-4 accent-[var(--color-leaf)]"
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
            <span className="rounded border border-[var(--color-river)] bg-[var(--color-sky-wash)] px-2 py-1 text-[var(--color-river)]">
              Loading routes
            </span>
          )}
          {routesError !== null && (
            <span className="rounded border border-red-300/30 bg-red-300/10 px-2 py-1 text-red-200">
              Routes error
            </span>
          )}
          {!routesLoading && routesError === null && routes.features.length === 0 && (
            <span className="rounded border border-[var(--color-bark-border)] bg-[var(--color-bark-soft)] px-2 py-1 text-[var(--color-sage-text)]">
              No routes
            </span>
          )}
          {routeLoading && (
            <span className="rounded border border-[var(--color-leaf-border)] bg-[var(--color-leaf-wash)] px-2 py-1 text-[var(--color-leaf)]">
              Loading detail
            </span>
          )}
          {routeError !== null && (
            <span className="rounded border border-red-300/30 bg-red-300/10 px-2 py-1 text-red-200">
              Detail error
            </span>
          )}
          {facilitiesLoading && (
            <span className="rounded border border-[var(--color-river)] bg-[var(--color-sky-wash)] px-2 py-1 text-[var(--color-river)]">
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
      )}

      {routeDetail !== null && (
        <div className="absolute inset-x-3 bottom-3 z-30 sm:inset-x-auto sm:bottom-auto sm:right-3 sm:top-48 sm:w-96 sm:max-w-[36vw]">
          <RouteDetailPanel route={routeDetail} onClose={clearSelection} />
        </div>
      )}

      <Map
        ref={mapRef}
        initialViewState={view}
        mapStyle={CARTO_DARK_MATTER}
        interactiveLayerIds={['routes']}
        onLoad={() => setMapLoaded(true)}
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
            id="routes-casing"
            type="line"
            paint={{
              'line-color': '#223020',
              'line-opacity': routeOpacityExpression(
                hoveredId,
                CASING_FULL_OPACITY,
                CASING_DIM_OPACITY,
              ),
              'line-width': 6,
            }}
            filter={layerFilter}
          />
          <Layer
            id="routes"
            type="line"
            paint={{
              'line-color': lineColorFor(colorMode),
              'line-opacity': routeOpacityExpression(hoveredId),
              'line-width': 3,
            }}
            filter={layerFilter}
          />
        </Source>
      </Map>

      <div className="pointer-events-none absolute bottom-1 right-1 z-10 rounded bg-[var(--color-forest-panel)] px-2 py-0.5 text-[10px] text-[var(--color-sage-text)]">
        {ATTRIBUTION}
      </div>
    </main>
  );
}
