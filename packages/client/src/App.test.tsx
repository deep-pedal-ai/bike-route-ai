import type { ReactNode } from 'react';

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import App from './App';

type MapComponentProps = { children?: ReactNode };

vi.mock('react-map-gl/maplibre', async () => {
  const React = await import('react');
  // forwardRef so MapExplorer's `ref={mapRef}` doesn't warn; this suite only
  // checks routing, so the ref is accepted and ignored.
  const Map = React.forwardRef(
    ({ children }: MapComponentProps, _ref: React.ForwardedRef<unknown>): ReactNode => (
      <div data-testid="maplibre-map">{children}</div>
    ),
  );
  Map.displayName = 'Map';
  const Source = ({ children }: MapComponentProps): ReactNode => children ?? null;
  const Layer = (): ReactNode => null;
  return { __esModule: true, default: Map, Map, Source, Layer };
});

vi.mock('./hooks/use-corpus-routes', () => ({
  useCorpusRoutes: () => ({
    data: { type: 'FeatureCollection', features: [] },
    loading: false,
    error: null,
  }),
}));

vi.mock('./hooks/use-corpus-route', () => ({
  useCorpusRoute: () => ({ data: null, loading: false, error: null }),
}));

vi.mock('./hooks/use-facilities', () => ({
  useFacilities: () => ({ data: null, loading: false, error: null }),
}));

describe('App routing', () => {
  it('renders the Generate hero at /', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    );
    expect(screen.getByText('ride')).toBeInTheDocument();
    expect(screen.getByText('Search Routes')).toBeInTheDocument();
  });

  it('renders the MapExplorer at /map and not the hero', () => {
    render(
      <MemoryRouter initialEntries={['/map']}>
        <App />
      </MemoryRouter>
    );
    expect(screen.getByTestId('maplibre-map')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /facility overlay/i })).toBeInTheDocument();
    expect(screen.queryByText('ride')).not.toBeInTheDocument();
  });

  it('switches view and active link when the Map nav link is clicked', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    );

    expect(screen.getByText('ride')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Generate' })).toHaveClass(
      'text-[var(--color-leaf)]',
    );

    fireEvent.click(screen.getByRole('link', { name: 'Map' }));

    expect(screen.getByTestId('maplibre-map')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /facility overlay/i })).toBeInTheDocument();
    expect(screen.queryByText('ride')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Map' })).toHaveClass(
      'text-[var(--color-leaf)]',
    );
    expect(screen.getByRole('link', { name: 'Generate' })).not.toHaveClass(
      'text-[var(--color-leaf)]',
    );
  });
});
