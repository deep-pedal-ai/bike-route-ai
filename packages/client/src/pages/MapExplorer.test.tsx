import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
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
const { layerSpy, mapSpy, fitBoundsSpy } = vi.hoisted(() => ({
  layerSpy: vi.fn(),
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
  const Source = (props: MapComponentProps): ReactNode => props.children ?? null;
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

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <MapExplorer />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  layerSpy.mockClear();
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

  it('passes route=null to the detail hook when no ?route param is present', () => {
    renderAt('/map');
    expect(mockedUseCorpusRoute).toHaveBeenCalledWith(null);
  });

  it('toggling the facility overlay flips useFacilities enabled from false to true', () => {
    renderAt('/map');

    // Before the toggle, every call passed enabled=false (3rd arg).
    expect(mockedUseFacilities.mock.calls.every((c) => c[2] === false)).toBe(true);

    fireEvent.click(screen.getByRole('checkbox', { name: /facility overlay/i }));

    // After the toggle, at least one call passed enabled=true.
    expect(mockedUseFacilities.mock.calls.some((c) => c[2] === true)).toBe(true);
  });

  it('a FilterBar change updates the route Layer filter prop', () => {
    renderAt('/map');

    const before = routeLayerProps()?.filter;
    expect(before).toEqual(['all']);

    // FilterBar renders a button per source; clicking 'canon' selects it.
    fireEvent.click(screen.getByRole('button', { name: 'canon' }));

    const after = routeLayerProps()?.filter;
    expect(after).not.toEqual(before);
    expect(after).toEqual(['all', ['any', ['==', ['get', 'source'], 'canon']]]);
  });

  it('the color-mode toggle swaps the route Layer paint expression', () => {
    renderAt('/map');

    const before = routeLayerProps()?.paint;

    fireEvent.click(screen.getByRole('button', { name: /color mode/i }));

    const after = routeLayerProps()?.paint;
    expect(after).not.toEqual(before);
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
  it('opens the panel (skeleton) and hides the FilterBar while loading — before any results exist', async () => {
    let release: (() => void) | undefined;
    mockedSearchRoutes.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({ results: [searchResult('286', 'Aqueduct Trail')], filtersRelaxed: false });
        }),
    );

    renderAt('/map');
    // FilterBar is present before searching.
    expect(screen.getByRole('button', { name: 'canon' })).toBeInTheDocument();

    submitSearch('aqueduct');

    // panelOpen is true while loading — results is still null.
    const panel = screen.getByRole('complementary', { name: /route search results/i });
    expect(within(panel).getByText('Searching…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'canon' })).not.toBeInTheDocument();

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

  it('filters both route layers to the resolved result ids (search supersedes FilterBar)', async () => {
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

    expect(fitBoundsSpy).toHaveBeenCalledWith(
      boundsForIds(['286', '4']),
      expect.objectContaining({ padding: 64 }),
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

    // Camera frames the clicked route…
    expect(fitBoundsSpy).toHaveBeenCalledWith(
      boundsForIds(['286']),
      expect.objectContaining({ padding: 64 }),
    );
    // …and the detail panel opens for that id (Number-normalized).
    expect(mockedUseCorpusRoute).toHaveBeenCalledWith(286);
  });

  it('closing the panel clears the search and restores the FilterBar + full filter', async () => {
    mockedSearchRoutes.mockResolvedValue({
      results: [searchResult('286', 'Aqueduct Trail')],
      filtersRelaxed: false,
    });

    renderAt('/map');
    submitSearch('aqueduct');
    await screen.findByText('Aqueduct Trail');
    expect(routeLayerProps()?.filter).toEqual(buildIdFilter(['286']));

    fireEvent.click(screen.getByRole('button', { name: /close search/i }));

    // FilterBar returns and the membership filter gives way to the full filter.
    expect(screen.getByRole('button', { name: 'canon' })).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: /route search results/i })).not.toBeInTheDocument();
    expect(routeLayerProps()?.filter).toEqual(['all']);
  });
});
