import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Map, Source, Layer } from 'react-map-gl/maplibre';
import { useSearchParams } from 'react-router-dom';
import 'maplibre-gl/dist/maplibre-gl.css';

import { SlidersHorizontal } from 'lucide-react';

import FilterBar from '../components/FilterBar';
import FilterSheet from '../components/FilterSheet';
import Legend from '../components/Legend';
import RegionSwitcher from '../components/RegionSwitcher';
import RouteDetailPanel from '../components/RouteDetailPanel';
import SearchBar from '../components/SearchBar';
import SearchResultsPanel from '../components/SearchResultsPanel';
import SearchResultsDock from '../components/SearchResultsDock';
import { REGIONS, regionFor, DEFAULT_REGION } from '../regions';
import { useTheme } from '../theme/use-theme.js';
import { useIsMobile } from '../hooks/use-is-mobile';
import { useCorpusRoutes } from '../hooks/use-corpus-routes';
import { useCorpusRoute } from '../hooks/use-corpus-route';
import { useFacilities } from '../hooks/use-facilities';
import { useRouteSearch } from '../hooks/use-route-search';
import { colorBySource, colorByQuality } from '../utils/route-color';
import { facilityColor } from '../utils/facility-color';
import { poiColor } from '../utils/poi-color';
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
  PoiBucket,
  PoiSummary,
  RouteSearchResult,
} from '@bike-route-ai/shared';
import type { FeatureCollection, Point } from 'geojson';

type ColorMode = 'source' | 'quality';
type MapView = {
  longitude: number;
  latitude: number;
  zoom: number;
};

const SOURCES = ['osm_relation', 'canon', 'generated', 'nysdot'] as const;
const FACILITY_CLASSES = ['protected', 'lane', 'sharrow', 'greenway', 'other'] as const;
// Stable bucket ordering for the POI pin colour `match` expression. Mirrors the
// five display buckets in the shared contract (PoiBucket).
const POI_BUCKETS: PoiBucket[] = [
  'coffee_food',
  'water_rest',
  'scenic',
  'landmark',
  'bike_services',
];

// Per-region initial camera lookup. Slice 1 has only NY; the default center +
// zoom comes from the region registry (regions.ts), structured per-region so
// adding a region is data, not a code change. (No geolocate / soft-suggest in
// Slice 1 — those are a later slice.)

// Baseline breathing room (px) between a framed route and the map edge. The
// per-panel padding in framePadding builds on top of this.
const MAP_GUTTER = 64;

const CARTO_DARK_MATTER =
  'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

// Light basemap: CARTO Voyager — fresh, cream-toned tiles for the default light
// theme. Selected from the live theme so the basemap flips with the toggle.
const CARTO_VOYAGER =
  'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json';

// Casing (halo) under each route line. Strava/Google convention: a dark halo on
// dark tiles, a light/white halo on light tiles so the saturated line pops off
// the cream Voyager basemap.
const CASING_COLOR_DARK = '#223020';
const CASING_COLOR_LIGHT = '#f5f6f1';

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

// `['match', ['get','bucket'], 'coffee_food', <c>, …, <fallback>]` — POI pins
// coloured per bucket via the single-sourced poiColor util.
function poiPaintExpression(): ExpressionSpecification {
  return [
    'match',
    ['get', 'bucket'],
    ...POI_BUCKETS.flatMap((bucket) => [bucket, poiColor(bucket)]),
    poiColor('__unknown__'),
  ] as unknown as ExpressionSpecification;
}

// Build a [lng,lat] FeatureCollection of Points (EPSG:4326) from the selected
// route's POIs. The geometry order is [lng, lat]; the Google Maps deep-link in
// the detail panel uses the reverse (lat,lng) — keep them distinct.
function poisToFeatureCollection(
  pois: PoiSummary[],
): FeatureCollection<Point, { bucket: PoiBucket }> {
  return {
    type: 'FeatureCollection',
    features: pois.map((poi) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [poi.lng, poi.lat] },
      properties: { bucket: poi.bucket },
    })),
  };
}

// --- SUBTLE cycling-tune of the light basemap. Voyager is already fresh, so
// this only nudges: car-road layers fade toward a neutral gray / lower opacity
// so they recede behind routes, while nature layers (parks, landcover/landuse,
// water) lift a touch greener/bluer. Layer ids vary between basemap revisions,
// so we walk the live style by id prefix and guard every paint write. Pure side
// effect on the passed map; idempotent (re-running re-applies the same values),
// so it's safe to call on every styledata event. ---

// Layer-id prefixes we tune, grouped by the property write each group needs.
const ROAD_PREFIXES = ['road_', 'bridge_', 'tunnel_'];
const PARK_PREFIXES = ['park_', 'poi_park'];
const GREEN_PREFIXES = ['landcover', 'landuse'];
const WATER_PREFIXES = ['water', 'waterway'];

type TunableMap = {
  getStyle?: () => { layers?: Array<{ id?: string; type?: string }> } | undefined;
  getLayer?: (id: string) => unknown;
  setPaintProperty?: (id: string, prop: string, value: unknown) => void;
};

// Gently set a paint property, swallowing the throw MapLibre raises when a layer
// id is absent or the property doesn't apply to that layer type.
function nudgePaint(map: TunableMap, id: string, prop: string, value: unknown): void {
  try {
    if (typeof map.getLayer === 'function' && map.getLayer(id) === undefined) return;
    map.setPaintProperty?.(id, prop, value);
  } catch {
    // Layer id varies / property not applicable — skip silently.
  }
}

function startsWithAny(id: string, prefixes: string[]): boolean {
  return prefixes.some((p) => id.startsWith(p));
}

function applyCyclingTune(map: TunableMap | null | undefined): void {
  // Bail cleanly when handed the test's fake map (no getStyle) or a half-loaded
  // GL map — this early return is what keeps the suite green.
  if (!map || typeof map.getStyle !== 'function') return;
  const style = map.getStyle();
  const layers = style?.layers;
  if (!Array.isArray(layers)) return;

  for (const layer of layers) {
    const id = layer?.id;
    if (typeof id !== 'string') continue;

    if (startsWithAny(id, ROAD_PREFIXES)) {
      // Mute car roads: blend the fill toward neutral gray and dial opacity back
      // a touch so routes sit clearly on top.
      if (layer.type === 'line') {
        nudgePaint(map, id, 'line-color', '#cfcdc6');
        nudgePaint(map, id, 'line-opacity', 0.85);
      } else if (layer.type === 'fill') {
        nudgePaint(map, id, 'fill-color', '#dad8d1');
        nudgePaint(map, id, 'fill-opacity', 0.85);
      }
    } else if (startsWithAny(id, PARK_PREFIXES) || startsWithAny(id, GREEN_PREFIXES)) {
      // Lift nature a hair greener.
      if (layer.type === 'fill') {
        nudgePaint(map, id, 'fill-color', '#dce9cf');
      } else if (layer.type === 'line') {
        nudgePaint(map, id, 'line-color', '#cfe0bf');
      }
    } else if (startsWithAny(id, WATER_PREFIXES)) {
      // Lift water a hair bluer.
      if (layer.type === 'fill') {
        nudgePaint(map, id, 'fill-color', '#cfe2ec');
      } else if (layer.type === 'line') {
        nudgePaint(map, id, 'line-color', '#bcd6e6');
      }
    }
  }
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

// Centre and zoom derived from route bounds; the region's default while empty.
function viewFromRoutes(routes: CorpusRoutesResponse, regionDefault: MapView): MapView {
  if (routes.features.length === 0) {
    return regionDefault;
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
  const { theme } = useTheme();
  const [searchParams, setSearchParams] = useSearchParams();
  // Read region from the URL (?region=, default 'ny'), alongside ?route=. The
  // registry validates/falls back, so a stray key never breaks the view.
  const regionParam = searchParams.get('region') ?? DEFAULT_REGION;
  const region = regionFor(regionParam);
  const [filterState, setFilterState] = useState<FilterState>({ sources: [] });
  const [colorMode, setColorMode] = useState<ColorMode>('source');
  const [overlayOn, setOverlayOn] = useState<boolean>(false);
  const [filterSheetOpen, setFilterSheetOpen] = useState<boolean>(false);
  const isMobile = useIsMobile();

  // Natural-language route search (shared with the Generate page). Id of the
  // result route the user is pointing at (string-normalized) drives the routes
  // layer's line-opacity: hovered route bright, others dimmed (D4).
  const search = useRouteSearch(region.key);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // Wraps the floating SearchBar so focus can return to it when the panel closes.
  const searchFieldRef = useRef<HTMLDivElement>(null);

  const {
    data: routesData,
    loading: routesLoading,
    error: routesError,
  } = useCorpusRoutes(region.key);
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

  // POIs for the selected route (S9). Present only once the detail loads with a
  // non-empty `pois` array; otherwise the layer renders nothing. Memoized so the
  // FeatureCollection identity is stable across unrelated re-renders.
  const pois = useMemo(() => routeDetail?.properties.pois ?? [], [routeDetail]);
  const poiCollection = useMemo(() => poisToFeatureCollection(pois), [pois]);
  const hasPois = pois.length > 0;

  const view = viewFromRoutes(routes, region.defaultView);

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
      opts?: {
        duration?: number;
        maxZoom?: number;
        padding?: number | { top: number; bottom: number; left: number; right: number };
      },
    ) => {
      mapRef.current?.fitBounds(bounds, {
        padding: MAP_GUTTER,
        duration: 600,
        maxZoom: 15,
        ...opts,
      });
    },
    [],
  );

  // Asymmetric fitBounds padding so a framed route lands in the strip of map the
  // floating panels don't cover. Each side reserves its panel's footprint (px)
  // when that panel is showing, otherwise a plain gutter. Clamped to the live
  // map size so narrow viewports (where panels span full width) can't ask for
  // padding wider than the map, which MapLibre rejects.
  const framePadding = useCallback(
    (sides: { left?: boolean; right?: boolean; top?: boolean }) => {
      const container = mapRef.current?.getContainer?.();

      // Mobile: the search bar floats at the top and the results dock sits at the
      // bottom, so frame routes into the clear band between them. The left/right
      // panel reservations don't apply — reserve top (search) and bottom (dock).
      if (isMobile) {
        const height = container?.clientHeight ?? 0;
        const peek = Math.min(288, Math.max(168, height * 0.34));
        const pad = { top: 132, bottom: peek + 24, left: MAP_GUTTER, right: MAP_GUTTER };
        if (height > 0) {
          const maxY = Math.max(MAP_GUTTER, (height - 96) / 2);
          pad.top = Math.min(pad.top, maxY);
          pad.bottom = Math.min(pad.bottom, maxY);
        }
        return pad;
      }

      const pad = {
        top: sides.top ? 224 : MAP_GUTTER, // top-center search bar
        bottom: MAP_GUTTER,
        left: sides.left ? 452 : MAP_GUTTER, // 26rem results panel + offset + breathing room
        right: sides.right ? 420 : MAP_GUTTER, // 24rem detail panel + offset + breathing room
      };
      if (container) {
        const maxX = Math.max(MAP_GUTTER, (container.clientWidth - 96) / 2);
        const maxY = Math.max(MAP_GUTTER, (container.clientHeight - 96) / 2);
        pad.left = Math.min(pad.left, maxX);
        pad.right = Math.min(pad.right, maxX);
        pad.top = Math.min(pad.top, maxY);
        pad.bottom = Math.min(pad.bottom, maxY);
      }
      return pad;
    },
    [isMobile],
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
    // Results panel (left) and search bar (top) are open here; reserve their space.
    focusBounds(fitBoundsFromFeatures({ type: 'FeatureCollection', features: mappable }), {
      padding: framePadding({ left: true, top: true }),
    });
  }, [search.results, routes, focusBounds, framePadding]);

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

  // Switch the active region via the URL (?region=). Drop ?route= because a
  // route id belongs to one region's corpus, so it can't survive the switch.
  const selectRegion = (key: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('region', key);
    next.delete('route');
    setSearchParams(next);
  };

  // Click a mappable result card → animate to frame it + open its detail panel
  // (D5). The null guard is belt-and-braces: no-geometry cards aren't clickable.
  const handleSelectResult = (id: string) => {
    const bounds = boundsForRouteId(routes, id);
    if (bounds === null) return;
    // Selecting frames one route with the results panel (left) open and the
    // detail panel (right) about to open, under the top search bar — reserve
    // all three so the route stays clear of every floating panel.
    focusBounds(bounds, { padding: framePadding({ left: true, right: true, top: true }) });
    selectRoute(id);
  };

  // Scroll a card into focus in the mobile dock → zoom the map to that route
  // (without opening its detail), so the camera follows whichever card covers
  // most of the screen. Stable identity keeps the dock's scroll effect from
  // re-firing every render. A short duration keeps the camera tracking the swipe.
  const handleCenterResult = useCallback(
    (id: string) => {
      const bounds = boundsForRouteId(routes, id);
      if (bounds === null) return;
      focusBounds(bounds, { padding: framePadding({}), duration: 400 });
    },
    [routes, focusBounds, framePadding],
  );

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

  // Basemap and casing flip with the theme. Voyager (cream) under light, Dark
  // Matter under dark; react-map-gl re-runs setStyle when mapStyle changes.
  const isLight = theme === 'light';
  const mapStyle = isLight ? CARTO_VOYAGER : CARTO_DARK_MATTER;
  const casingColor = isLight ? CASING_COLOR_LIGHT : CASING_COLOR_DARK;

  // Apply the SUBTLE cycling-tune (light only) from the map event's target. Runs
  // on first load AND on every styledata so a theme switch — which reloads the
  // basemap async — re-tunes once the new style's layers exist. Guarded inside
  // applyCyclingTune so the test's fake map (no getStyle) is a clean no-op.
  const tuneFromEvent = useCallback(
    (event: { target?: TunableMap }) => {
      if (!isLight) return;
      applyCyclingTune(event?.target);
    },
    [isLight],
  );

  return (
    <main className="relative h-[calc(100dvh-4rem)] w-full overflow-hidden bg-[var(--color-forest)]">
      {/* Region switcher — top-left, distinct from the centered search bar. The
          read partition key; clicking a pill updates ?region= in the URL. */}
      <div className="absolute left-3 top-3 z-40">
        <RegionSwitcher regions={REGIONS} current={region.key} onChange={selectRegion} />
      </div>

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

      {panelOpen && !isMobile && (
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

      {panelOpen && isMobile && (
        <SearchResultsDock
          results={search.results}
          mappableIds={loadedRouteIds}
          selectedId={routeParam}
          filtersRelaxed={search.filtersRelaxed}
          isLoading={search.isLoading}
          error={search.error}
          onHover={setHoveredId}
          onSelect={handleSelectResult}
          onCenter={handleCenterResult}
          onClose={handleCloseSearch}
          detail={routeDetail}
          detailLoading={routeLoading}
          onCollapseDetail={clearSelection}
        />
      )}

      {/* FilterBar / Legend — desktop only; hidden while the search panel is open
          (D1). On mobile this lives behind a filter button + bottom sheet. */}
      {!panelOpen && !isMobile && (
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
            <span className="rounded border border-[var(--color-danger-border)] bg-[var(--color-danger-wash)] px-2 py-1 text-[var(--color-danger)]">
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
            <span className="rounded border border-[var(--color-danger-border)] bg-[var(--color-danger-wash)] px-2 py-1 text-[var(--color-danger)]">
              Detail error
            </span>
          )}
          {facilitiesLoading && (
            <span className="rounded border border-[var(--color-river)] bg-[var(--color-sky-wash)] px-2 py-1 text-[var(--color-river)]">
              Loading facilities
            </span>
          )}
          {facilitiesError !== null && (
            <span className="rounded border border-[var(--color-danger-border)] bg-[var(--color-danger-wash)] px-2 py-1 text-[var(--color-danger)]">
              Facilities error
            </span>
          )}
        </div>
      </div>
      )}

      {/* Mobile filter affordance — one tap opens the controls in a bottom sheet,
          keeping the default mobile view to just map + search. */}
      {!panelOpen && isMobile && (
        <button
          type="button"
          onClick={() => setFilterSheetOpen(true)}
          aria-label="Filters and layers"
          className="absolute bottom-4 left-4 z-30 flex h-12 w-12 items-center justify-center rounded-full border border-[var(--color-bark-border)] bg-[var(--color-forest-panel)] text-[var(--color-cream)] shadow-[0_12px_30px_rgba(16,20,15,0.5)] backdrop-blur-md transition hover:border-[var(--color-leaf)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-leaf)]"
        >
          <SlidersHorizontal className="h-5 w-5" />
        </button>
      )}

      <FilterSheet
        open={isMobile && filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        filterState={filterState}
        onFilterChange={setFilterState}
        colorMode={colorMode}
        onColorModeChange={setColorMode}
        overlayOn={overlayOn}
        onOverlayChange={setOverlayOn}
        sourceSwatches={SOURCE_SWATCHES}
        qualityGradient={QUALITY_GRADIENT}
        facilitySwatches={FACILITY_SWATCHES}
      />

      {/* Detail sheet: desktop always; on mobile only when the dock isn't already
          hosting the detail in its expanded state. */}
      {routeDetail !== null && !(isMobile && panelOpen) && (
        <div className="absolute inset-x-3 bottom-3 z-30 sm:inset-x-auto sm:bottom-auto sm:right-3 sm:top-48 sm:w-96 sm:max-w-[36vw]">
          <RouteDetailPanel route={routeDetail} onClose={clearSelection} />
        </div>
      )}

      <Map
        ref={mapRef}
        initialViewState={view}
        mapStyle={mapStyle}
        interactiveLayerIds={['routes']}
        onLoad={(event) => {
          setMapLoaded(true);
          tuneFromEvent(event);
        }}
        onStyleData={tuneFromEvent}
        onClick={(event) => {
          const feature = event.features?.[0];
          const id = feature?.properties?.id;
          if (typeof id === 'number') {
            selectRoute(id);
          }
        }}
      >
        {/* POI pins for the selected route render UNDER the facilities + routes
            layers (rendered first). Mounted only when the selected route detail
            carries POIs, so clearing the selection removes the layer entirely. */}
        {hasPois && (
          <Source id="pois" type="geojson" data={poiCollection}>
            <Layer
              id="pois"
              type="circle"
              // Insert below the facilities layer. The pois layer mounts only
              // after the async route detail resolves — by then the unconditional
              // `facilities` layer already exists, so beforeId places pins under
              // both facilities and routes regardless of mount order.
              beforeId="facilities"
              paint={{
                'circle-color': poiPaintExpression(),
                'circle-radius': 5,
                'circle-stroke-color': casingColor,
                'circle-stroke-width': 1.5,
                'circle-opacity': 0.95,
              }}
            />
          </Source>
        )}

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
              'line-color': casingColor,
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
