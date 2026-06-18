import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

import MapExplorer from './MapExplorer';
import { useCorpusRoutes } from '../hooks/use-corpus-routes';
import { useCorpusRoute } from '../hooks/use-corpus-route';
import { useFacilities } from '../hooks/use-facilities';
import { searchRoutes } from '../api/route-search';
import { fitBoundsFromFeatures } from '../utils/bounds';
import { buildIdFilter } from '../utils/maplibre-filter';
import { routeOpacityExpression } from '../utils/route-search-view';
import fixture from '../fixtures/corpus-sample.json';

import type { FeatureCollection, LineString } from 'geojson';
import type { CorpusRouteProps, RouteSearchResult } from '@bike-route-ai/shared';

// --- Mock the inert map components. The factory cannot reference top-level
// imports (vi.mock is hoisted), so spies are created via vi.hoisted. Each map
// component renders its children so nested Source/Layer still mount; Layer
// records its props for assertions.
//
// The Map mock is a forwardRef component: it publishes a fake MapRef whose only
// method is the `fitBounds` spy (via useImperativeHandle, a commit-phase/layout
// effect), and fires `onLoad` on mount. That lets the imperative-camera
// refactor (ref + onLoad → fitBounds) be asserted without a real GL context:
// useImperativeHandle populates `mapRef.current` in the first commit, then the
// onLoad→setMapLoaded re-render lets MapExplorer's passive fit effect call
// fitBounds.
const { layerSpy, sourceSpy, mapSpy, fitBoundsSpy } = vi.hoisted(() => ({
  layerSpy: vi.fn(),
  sourceSpy: vi.fn(),
  mapSpy: vi.fn(),
  fitBoundsSpy: vi.fn(),
}));

type MapComponentProps = Record<string, unknown> & { children?: ReactNode };

vi.mock('react-map-gl/maplibre', async () => {
  const React = await import('react');
  const Map = React.forwardRef(
    (props: MapComponentProps, ref: React.ForwardedRef<unknown>): ReactNode => {
      mapSpy(props);
      React.useImperativeHandle(ref, () => ({ fitBounds: fitBoundsSpy }), []);
      const onLoad = props.onLoad as (() => void) | undefined;
      React.useEffect(() => {
        // Simulate the GL map firing `load` once after mount.
        onLoad?.();
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return props.children ?? null;
    },
  );
  Map.displayName = 'Map';
  const Source = (props: MapComponentProps): ReactNode => {
    sourceSpy(props);
    return props.children ?? null;
  };
  const Layer = (props: MapComponentProps): ReactNode => {
    layerSpy(props);
    return null;
  };
  return { __esModule: true, default: Map, Map, Source, Layer };
});

vi.mock('../hooks/use-corpus-routes', () => ({ useCorpusRoutes: vi.fn() }));
vi.mock('../hooks/use-corpus-route', () => ({ useCorpusRoute: vi.fn() }));
vi.mock('../hooks/use-facilities', () => ({ useFacilities: vi.fn() }));
vi.mock('../api/route-search', () => ({ searchRoutes: vi.fn() }));

const mockedUseCorpusRoutes = vi.mocked(useCorpusRoutes);
const mockedUseCorpusRoute = vi.mocked(useCorpusRoute);
const mockedUseFacilities = vi.mocked(useFacilities);
const mockedSearchRoutes = vi.mocked(searchRoutes);

const corpusRoutes = fixture.routes as unknown as FeatureCollection<
  LineString,
  CorpusRouteProps
>;

function searchResult(id: string, name: string): RouteSearchResult {
  return {
    id,
    name,
    distanceKm: 20,
    ascentM: 100,
    isLoop: false,
    qualityScore: 0.7,
    surfaceBreakdown: null,
    blurb: `${name} blurb`,
  };
}

// Union bounds of the corpus features matching these ids — what the camera
// should frame when a search resolves.
function boundsForIds(ids: string[]): [[number, number], [number, number]] {
  const features = corpusRoutes.features.filter((f) =>
    ids.includes(String(f.properties.id)),
  );
  return fitBoundsFromFeatures({ type: 'FeatureCollection', features });
}

// Type a query into the floating SearchBar and submit it.
function submitSearch(query: string) {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: query } });
  fireEvent.click(screen.getByRole('button', { name: /search routes/i }));
}

// Latest props captured for the route line layer (id 'routes'). The facilities
// overlay also renders a Layer, so filter by id to avoid mixing them up.
function routeLayerProps(): Record<string, unknown> | undefined {
  const calls = layerSpy.mock.calls.filter(
    (c) => (c[0] as { id?: string }).id === 'routes',
  );
  return calls.at(-1)?.[0] as Record<string, unknown> | undefined;
}

function casingLayerProps(): Record<string, unknown> | undefined {
  const calls = layerSpy.mock.calls.filter(
    (c) => (c[0] as { id?: string }).id === 'routes-casing',
  );
  return calls.at(-1)?.[0] as Record<string, unknown> | undefined;
}

// Latest props captured for the POI layer / source (id 'pois').
function poiLayerProps(): Record<string, unknown> | undefined {
  const calls = layerSpy.mock.calls.filter(
    (c) => (c[0] as { id?: string }).id === 'pois',
  );
  return calls.at(-1)?.[0] as Record<string, unknown> | undefined;
}

function poiSourceProps(): Record<string, unknown> | undefined {
  const calls = sourceSpy.mock.calls.filter(
    (c) => (c[0] as { id?: string }).id === 'pois',
  );
  return calls.at(-1)?.[0] as Record<string, unknown> | undefined;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <MapExplorer />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  layerSpy.mockClear();
  sourceSpy.mockClear();
  mapSpy.mockClear();
  fitBoundsSpy.mockClear();
  mockedSearchRoutes.mockReset();
  mockedUseCorpusRoutes.mockReturnValue({
    data: fixture.routes as never,
    loading: false,
    error: null,
  });
  mockedUseCorpusRoute.mockReturnValue({
    data: null,
    loading: false,
    error: null,
  });
  mockedUseFacilities.mockReturnValue({
    data: null,
    loading: false,
    error: null,
  });
});

describe('MapExplorer', () => {
  it('deep-links: on cold load with ?route=286 it fetches that id and opens the detail panel', () => {
    mockedUseCorpusRoute.mockReturnValue({
      data: fixture.routeDetail as never,
      loading: false,
      error: null,
    });

    renderAt('/map?route=286');

    // The hook is called with the numeric id (not the raw '286' string).
    expect(mockedUseCorpusRoute).toHaveBeenCalledWith(286);
    // And the panel renders that route's data.
    expect(screen.getByText('Prospect Park Loop (double)')).toBeInTheDocument();
  });

  it('deep-links: zooms the camera to the selected route after the corpus loads', () => {
    mockedUseCorpusRoute.mockReturnValue({
      data: fixture.routeDetail as never,
      loading: false,
      error: null,
    });

    renderAt('/map?route=286');

    expect(fitBoundsSpy).toHaveBeenCalledWith(
      boundsForIds(['286']),
      expect.objectContaining({
        maxZoom: 16,
        padding: { top: 224, bottom: 64, left: 452, right: 420 },
      }),
    );
  });

  it('passes route=null to the detail hook when no ?route param is present', () => {
    renderAt('/map');
    expect(mockedUseCorpusRoute).toHaveBeenCalledWith(null);
  });

  it('toggling the facility overlay flips useFacilities enabled from false to true', () => {
    renderAt('/map');

    // Before the toggle, every call passed enabled=false (3rd arg).
    expect(mockedUseFacilities.mock.calls.every((c) => c[2] === false)).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /facility overlay/i }));

    // After the toggle, at least one call passed enabled=true.
    expect(mockedUseFacilities.mock.calls.some((c) => c[2] === true)).toBe(true);
  });

  it('typing a min distance updates the route Layer filter prop (km)', () => {
    renderAt('/map');

    const before = routeLayerProps()?.filter;
    expect(before).toEqual(['all']);

    // The distance filter lives under the search input; a km value adds a
    // distance_km lower-bound clause to the layer filter.
    fireEvent.change(screen.getByLabelText('Minimum distance'), {
      target: { value: '5' },
    });

    const after = routeLayerProps()?.filter;
    expect(after).toEqual(['all', ['>=', ['get', 'distance_km'], 5]]);
  });

  it('a min distance entered in miles reaches the filter converted to km', () => {
    renderAt('/map');

    // Switch the unit to miles, then enter 5 — the stored bound must be km.
    fireEvent.click(screen.getByRole('button', { name: /switch to miles/i }));
    fireEvent.change(screen.getByLabelText('Minimum distance'), {
      target: { value: '5' },
    });

    expect(routeLayerProps()?.filter).toEqual([
      'all',
      ['>=', ['get', 'distance_km'], 5 * 1.609344],
    ]);
  });

  it('fits the initial map view to loaded corpus bounds instead of using the narrow NY default', () => {
    renderAt('/map');

    const props = mapSpy.mock.calls.at(-1)?.[0] as
      | { initialViewState?: { zoom?: number } }
      | undefined;

    expect(props?.initialViewState?.zoom).toBeLessThan(10);
  });

  it('drives the routes layer line-opacity through routeOpacityExpression (uniform when nothing is hovered)', () => {
    renderAt('/map');

    const paint = routeLayerProps()?.paint as Record<string, unknown>;
    expect(paint['line-opacity']).toEqual(routeOpacityExpression(null));
  });

  it('frames all routes on load via an imperative fitBounds (no key remount)', () => {
    renderAt('/map');

    // On load the camera fits the union of every loaded route, padded — this is
    // the imperative replacement for the old `<Map key=…>` remount-to-refit.
    const expectedBounds = fitBoundsFromFeatures(fixture.routes as never);
    expect(fitBoundsSpy).toHaveBeenCalledWith(
      expectedBounds,
      expect.objectContaining({ padding: 64 }),
    );
  });
});

describe('MapExplorer — map-tab search', () => {
  // Corpus fixture carries route ids 4 and 286 (among others); search results
  // keyed to those ids are "mappable", an out-of-corpus id is not.
  it('opens the panel (skeleton) while loading — before any results exist', async () => {
    let release: (() => void) | undefined;
    mockedSearchRoutes.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({ results: [searchResult('286', 'Aqueduct Trail')], filtersRelaxed: false });
        }),
    );

    renderAt('/map');

    submitSearch('aqueduct');

    // panelOpen is true while loading — results is still null.
    const panel = screen.getByRole('complementary', { name: /route search results/i });
    expect(within(panel).getByText('Searching…')).toBeInTheDocument();

    // Flush the pending request so its trailing state updates don't leak.
    await act(async () => {
      release?.();
    });
  });

  it('renders the error state in the panel when the search fails', async () => {
    mockedSearchRoutes.mockRejectedValue(new Error('Search unavailable'));

    renderAt('/map');
    submitSearch('quiet loop');

    expect(await screen.findByText('Search unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /close search/i })).toBeInTheDocument();
  });

  it('filters both route layers to the resolved result ids (search supersedes the distance filter)', async () => {
    mockedSearchRoutes.mockResolvedValue({
      results: [searchResult('286', 'Aqueduct Trail'), searchResult('4', 'Ridge Run')],
      filtersRelaxed: false,
    });

    renderAt('/map');
    submitSearch('two routes');
    await screen.findByText('Aqueduct Trail');

    const expected = buildIdFilter(['286', '4']);
    expect(routeLayerProps()?.filter).toEqual(expected);
    expect(casingLayerProps()?.filter).toEqual(expected);
  });

  it('frames the union of the mappable results when they arrive', async () => {
    mockedSearchRoutes.mockResolvedValue({
      results: [searchResult('286', 'Aqueduct Trail'), searchResult('4', 'Ridge Run')],
      filtersRelaxed: false,
    });

    renderAt('/map');
    fitBoundsSpy.mockClear(); // ignore the initial fit-to-all
    submitSearch('two routes');
    await screen.findByText('Aqueduct Trail');

    // Results panel (left) + search bar (top) are open, so their footprint is
    // reserved; the right side keeps the plain gutter.
    expect(fitBoundsSpy).toHaveBeenCalledWith(
      boundsForIds(['286', '4']),
      expect.objectContaining({ padding: { top: 224, bottom: 64, left: 452, right: 64 } }),
    );
  });

  it('does not move the camera when no result is mappable', async () => {
    mockedSearchRoutes.mockResolvedValue({
      results: [searchResult('9999999', 'Phantom Route')],
      filtersRelaxed: false,
    });

    renderAt('/map');
    fitBoundsSpy.mockClear();
    submitSearch('phantom');
    await screen.findByText('Phantom Route');

    expect(fitBoundsSpy).not.toHaveBeenCalled();
    // The unmappable result is shown read-only with the hint, not as a button.
    expect(screen.getByText(/no map preview/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /focus phantom route/i })).not.toBeInTheDocument();
  });

  it('hovering a result card drives the routes layer opacity expression', async () => {
    mockedSearchRoutes.mockResolvedValue({
      results: [searchResult('286', 'Aqueduct Trail')],
      filtersRelaxed: false,
    });

    renderAt('/map');
    submitSearch('aqueduct');
    await screen.findByText('Aqueduct Trail');

    // Uniform before hover.
    expect((routeLayerProps()?.paint as Record<string, unknown>)['line-opacity']).toEqual(
      routeOpacityExpression(null),
    );

    fireEvent.mouseEnter(screen.getByRole('button', { name: /focus aqueduct trail/i }));
    expect((routeLayerProps()?.paint as Record<string, unknown>)['line-opacity']).toEqual(
      routeOpacityExpression('286'),
    );
  });

  it('clicking a mappable card frames it and opens its detail panel', async () => {
    mockedSearchRoutes.mockResolvedValue({
      results: [searchResult('286', 'Aqueduct Trail')],
      filtersRelaxed: false,
    });

    renderAt('/map');
    submitSearch('aqueduct');
    await screen.findByText('Aqueduct Trail');
    fitBoundsSpy.mockClear();

    fireEvent.click(screen.getByRole('button', { name: /focus aqueduct trail/i }));

    // Camera frames the clicked route, reserving space for the results panel
    // (left), the about-to-open detail panel (right), and the search bar (top).
    expect(fitBoundsSpy).toHaveBeenCalledWith(
      boundsForIds(['286']),
      expect.objectContaining({ padding: { top: 224, bottom: 64, left: 452, right: 420 } }),
    );
    // …and the detail panel opens for that id (Number-normalized).
    expect(mockedUseCorpusRoute).toHaveBeenCalledWith(286);
  });

  it('closing the panel clears the search and restores the full filter', async () => {
    mockedSearchRoutes.mockResolvedValue({
      results: [searchResult('286', 'Aqueduct Trail')],
      filtersRelaxed: false,
    });

    renderAt('/map');
    submitSearch('aqueduct');
    await screen.findByText('Aqueduct Trail');
    expect(routeLayerProps()?.filter).toEqual(buildIdFilter(['286']));

    fireEvent.click(screen.getByRole('button', { name: /close search/i }));

    // The membership filter gives way to the full filter.
    expect(screen.queryByRole('complementary', { name: /route search results/i })).not.toBeInTheDocument();
    expect(routeLayerProps()?.filter).toEqual(['all']);
  });

  it('also dims the casing of non-hovered routes on hover', async () => {
    mockedSearchRoutes.mockResolvedValue({
      results: [searchResult('286', 'Aqueduct Trail')],
      filtersRelaxed: false,
    });

    renderAt('/map');
    submitSearch('aqueduct');
    await screen.findByText('Aqueduct Trail');

    fireEvent.mouseEnter(screen.getByRole('button', { name: /focus aqueduct trail/i }));
    expect((casingLayerProps()?.paint as Record<string, unknown>)['line-opacity']).toEqual(
      routeOpacityExpression('286', 0.72, 0.08),
    );
  });

  it('Escape closes the panel and restores the full filter', async () => {
    mockedSearchRoutes.mockResolvedValue({
      results: [searchResult('286', 'Aqueduct Trail')],
      filtersRelaxed: false,
    });

    renderAt('/map');
    submitSearch('aqueduct');
    await screen.findByText('Aqueduct Trail');

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(
      screen.queryByRole('complementary', { name: /route search results/i }),
    ).not.toBeInTheDocument();
  });

  it('moves focus into the panel on open and back to the search field on close', async () => {
    mockedSearchRoutes.mockResolvedValue({
      results: [searchResult('286', 'Aqueduct Trail')],
      filtersRelaxed: false,
    });

    renderAt('/map');
    submitSearch('aqueduct');
    await screen.findByText('Aqueduct Trail');

    expect(screen.getByRole('complementary', { name: /route search results/i })).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: /close search/i }));
    expect(screen.getByRole('textbox', { name: /describe the route/i })).toHaveFocus();
  });

  it('exposes the floating search as a labelled search landmark', () => {
    renderAt('/map');
    expect(screen.getByRole('search', { name: /search routes/i })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /describe the route/i })).toBeInTheDocument();
  });

  it('marks the open route card with aria-current after clicking it', async () => {
    mockedSearchRoutes.mockResolvedValue({
      results: [searchResult('286', 'Aqueduct Trail')],
      filtersRelaxed: false,
    });

    renderAt('/map');
    submitSearch('aqueduct');
    await screen.findByText('Aqueduct Trail');

    fireEvent.click(screen.getByRole('button', { name: /focus aqueduct trail/i }));
    expect(screen.getByRole('button', { name: /focus aqueduct trail/i })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });
});

describe('MapExplorer — POI map layer', () => {
  // A selected route detail carrying two POIs in different buckets.
  function detailWithPois() {
    const base = fixture.routeDetail as unknown as Record<string, unknown>;
    const properties = base.properties as Record<string, unknown>;
    return {
      ...base,
      properties: {
        ...properties,
        pois: [
          {
            id: 1,
            name: 'Corner Café',
            bucket: 'coffee_food',
            lat: 40.67,
            lng: -73.97,
            distance_m: 120,
            position_fraction: 0.1,
            image_url: null,
            image_license: null,
            image_attribution: null,
          },
          {
            id: 2,
            name: 'River Overlook',
            bucket: 'scenic',
            lat: 40.66,
            lng: -73.96,
            distance_m: 300,
            position_fraction: 0.8,
            image_url: null,
            image_license: null,
            image_attribution: null,
          },
        ],
      },
    };
  }

  it('adds a pois source as a [lng,lat] FeatureCollection for the selected route', () => {
    mockedUseCorpusRoute.mockReturnValue({
      data: detailWithPois() as never,
      loading: false,
      error: null,
    });

    renderAt('/map?route=286');

    const data = poiSourceProps()?.data as
      | { type?: string; features?: Array<{ geometry?: { coordinates?: number[] } }> }
      | undefined;
    expect(data?.type).toBe('FeatureCollection');
    expect(data?.features).toHaveLength(2);
    // GeoJSON Point geometry is [lng, lat] — not [lat, lng].
    expect(data?.features?.[0].geometry?.coordinates).toEqual([-73.97, 40.67]);
  });

  it('colors POI pins by bucket', () => {
    mockedUseCorpusRoute.mockReturnValue({
      data: detailWithPois() as never,
      loading: false,
      error: null,
    });

    renderAt('/map?route=286');

    const paint = poiLayerProps()?.paint as Record<string, unknown> | undefined;
    const color = paint?.['circle-color'];
    // A `match` expression keyed on the bucket property.
    expect(Array.isArray(color)).toBe(true);
    expect((color as unknown[])[0]).toBe('match');
    expect((color as unknown[])[1]).toEqual(['get', 'bucket']);
    expect(color as unknown[]).toContain('coffee_food');
    expect(color as unknown[]).toContain('scenic');
  });

  it('places the POI layer below the facilities layer via beforeId', () => {
    mockedUseCorpusRoute.mockReturnValue({
      data: detailWithPois() as never,
      loading: false,
      error: null,
    });

    renderAt('/map?route=286');

    expect(poiLayerProps()?.beforeId).toBe('facilities');
  });

  it('renders no pois source/layer when the selection is cleared (no pois)', () => {
    // Default beforeEach mock: useCorpusRoute → data:null.
    renderAt('/map');
    expect(poiSourceProps()).toBeUndefined();
    expect(poiLayerProps()).toBeUndefined();
  });
});

// Force the viewport branch in useIsMobile. The setup file defaults matchMedia to
// `matches: false` (desktop); these tests flip it to mobile and restore after.
function setIsMobile(isMobile: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: isMobile,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

describe('MapExplorer — mobile layout', () => {
  afterEach(() => setIsMobile(false));

  it('renders the bottom dock and seeds the map highlight from the centered card', async () => {
    setIsMobile(true);
    mockedSearchRoutes.mockResolvedValue({
      results: [searchResult('286', 'Aqueduct Trail')],
      filtersRelaxed: false,
    });

    renderAt('/map');
    submitSearch('aqueduct');
    await screen.findByRole('button', { name: /focus aqueduct trail/i });

    // Dock-only affordance (the grabber) confirms the dock, not the desktop panel.
    expect(screen.getByRole('button', { name: /open the centered route/i })).toBeInTheDocument();

    // The centered card (first result) drives the highlight with no hover — the
    // touch replacement for desktop's hover-to-highlight.
    await waitFor(() => {
      expect((routeLayerProps()?.paint as Record<string, unknown>)['line-opacity']).toEqual(
        routeOpacityExpression('286'),
      );
    });
  });

  it('frames results into the bottom band (reserves dock space, not the side panels)', async () => {
    setIsMobile(true);
    mockedSearchRoutes.mockResolvedValue({
      results: [searchResult('286', 'Aqueduct Trail'), searchResult('4', 'Ridge Run')],
      filtersRelaxed: false,
    });

    renderAt('/map');
    fitBoundsSpy.mockClear();
    submitSearch('two routes');
    await screen.findByRole('button', { name: /focus aqueduct trail/i });

    // No container height in jsdom → peek clamps to 168, bottom = 168 + 24.
    expect(fitBoundsSpy).toHaveBeenCalledWith(
      boundsForIds(['286', '4']),
      expect.objectContaining({ padding: { top: 132, bottom: 192, left: 64, right: 64 } }),
    );
  });

  it('selecting a card expands the dock into the route detail', async () => {
    setIsMobile(true);
    mockedUseCorpusRoute.mockReturnValue({
      data: fixture.routeDetail as never,
      loading: false,
      error: null,
    });
    mockedSearchRoutes.mockResolvedValue({
      results: [searchResult('286', 'Aqueduct Trail')],
      filtersRelaxed: false,
    });

    renderAt('/map');
    submitSearch('aqueduct');
    fireEvent.click(await screen.findByRole('button', { name: /focus aqueduct trail/i }));

    // The dock grows to host the detail, with a collapse-back affordance.
    expect(screen.getByRole('button', { name: /back to results/i })).toBeInTheDocument();
    expect(screen.getByText('Prospect Park Loop (double)')).toBeInTheDocument();
  });

  it('exposes the distance filter and facility toggle without a filter sheet on mobile', () => {
    setIsMobile(true);

    renderAt('/map');

    // The source filter and its mobile bottom sheet were removed entirely.
    expect(screen.queryByRole('button', { name: 'canon' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /filters and layers/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /map filters/i })).not.toBeInTheDocument();

    // What survives: the distance filter (under the search input) and the
    // facility overlay toggle, both reachable on mobile.
    expect(screen.getByLabelText('Minimum distance')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /facility overlay/i })).toBeInTheDocument();
  });
});
