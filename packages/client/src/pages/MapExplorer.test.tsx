import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

import MapExplorer from './MapExplorer';
import { useCorpusRoutes } from '../hooks/use-corpus-routes';
import { useCorpusRoute } from '../hooks/use-corpus-route';
import { useFacilities } from '../hooks/use-facilities';
import fixture from '../fixtures/corpus-sample.json';

// --- Mock the inert map components. The factory cannot reference top-level
// imports (vi.mock is hoisted), so the prop-capture spy is created via
// vi.hoisted. Each map component renders its children so nested Source/Layer
// still mount; Layer records its props for assertions.
const { layerSpy } = vi.hoisted(() => ({ layerSpy: vi.fn() }));

type MapComponentProps = Record<string, unknown> & { children?: ReactNode };

vi.mock('react-map-gl/maplibre', () => {
  const Map = (props: MapComponentProps): ReactNode => props.children ?? null;
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

const mockedUseCorpusRoutes = vi.mocked(useCorpusRoutes);
const mockedUseCorpusRoute = vi.mocked(useCorpusRoute);
const mockedUseFacilities = vi.mocked(useFacilities);

// Latest props captured for the route line layer (id 'routes'). The facilities
// overlay also renders a Layer, so filter by id to avoid mixing them up.
function routeLayerProps(): Record<string, unknown> | undefined {
  const calls = layerSpy.mock.calls.filter(
    (c) => (c[0] as { id?: string }).id === 'routes',
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
});
