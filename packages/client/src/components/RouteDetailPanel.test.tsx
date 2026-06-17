import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RouteDetailPanel from './RouteDetailPanel';
import { CORPUS_FIELD_DOCS } from '../corpus-field-docs';
import fixture from '../fixtures/corpus-sample.json';
import type { Feature, LineString } from 'geojson';
import type { CorpusRouteDetailProps, PoiSummary } from '@bike-route-ai/shared';

const route = fixture.routeDetail as unknown as Feature<
  LineString,
  CorpusRouteDetailProps
>;

function poi(overrides: Partial<PoiSummary> = {}): PoiSummary {
  return {
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
    ...overrides,
  };
}

function routeWithPois(pois: PoiSummary[]): Feature<LineString, CorpusRouteDetailProps> {
  return {
    ...route,
    properties: { ...route.properties, pois },
  };
}

describe('RouteDetailPanel', () => {
  it('renders the route name, distance, and source', () => {
    render(<RouteDetailPanel route={route} onClose={vi.fn()} />);
    expect(screen.getByText('Prospect Park Loop (double)')).toBeInTheDocument();
    expect(screen.getByText('8.9')).toBeInTheDocument();
    expect(screen.getByText('canon')).toBeInTheDocument();
  });

  it('renders one surface bar segment per surface_breakdown key', () => {
    render(<RouteDetailPanel route={route} onClose={vi.fn()} />);
    const keys = Object.keys(route.properties.surface_breakdown ?? {});
    expect(keys.length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('surface-segment')).toHaveLength(keys.length);
  });

  it('exposes a CORPUS_FIELD_DOCS description as a label tooltip', () => {
    render(<RouteDetailPanel route={route} onClose={vi.fn()} />);
    expect(
      screen.getByTitle(CORPUS_FIELD_DOCS.match_quality),
    ).toBeInTheDocument();
  });

  it('renders nothing when route is null', () => {
    const { container } = render(
      <RouteDetailPanel route={null} onClose={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(<RouteDetailPanel route={route} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('RouteDetailPanel — POIs', () => {
  it('renders POIs grouped by bucket with name and distance', () => {
    render(
      <RouteDetailPanel
        route={routeWithPois([
          poi({ id: 1, name: 'Corner Café', bucket: 'coffee_food', distance_m: 120 }),
          poi({ id: 2, name: 'River Overlook', bucket: 'scenic', distance_m: 305.6 }),
        ])}
        onClose={vi.fn()}
      />,
    );

    // Bucket group headings.
    expect(screen.getByText(/coffee/i)).toBeInTheDocument();
    expect(screen.getByText(/scenic/i)).toBeInTheDocument();

    // Names + rounded distances.
    expect(screen.getByText('Corner Café')).toBeInTheDocument();
    expect(screen.getByText('River Overlook')).toBeInTheDocument();
    expect(screen.getByText('120 m')).toBeInTheDocument();
    expect(screen.getByText('306 m')).toBeInTheDocument();
  });

  it('shows an image thumbnail only when image_url is present', () => {
    render(
      <RouteDetailPanel
        route={routeWithPois([
          poi({ id: 1, name: 'Old Lighthouse', bucket: 'landmark', image_url: 'https://x/img.jpg', image_attribution: 'Photo by Jane, CC BY-SA 4.0' }),
          poi({ id: 2, name: 'Corner Café', bucket: 'coffee_food', image_url: null }),
        ])}
        onClose={vi.fn()}
      />,
    );

    const imgs = screen.getAllByRole('img');
    expect(imgs).toHaveLength(1);
    expect(imgs[0]).toHaveAttribute('src', 'https://x/img.jpg');
    // Attribution is surfaced alongside the image (Wikimedia requirement).
    expect(screen.getByText(/Photo by Jane, CC BY-SA 4.0/)).toBeInTheDocument();
  });

  it('builds the Google Maps href as ?api=1&query=LAT,LNG for the POI coords', () => {
    render(
      <RouteDetailPanel
        route={routeWithPois([poi({ name: 'Corner Café', lat: 40.67, lng: -73.97 })])}
        onClose={vi.fn()}
      />,
    );

    const link = screen.getByRole('link', { name: /google maps/i });
    expect(link).toHaveAttribute(
      'href',
      'https://www.google.com/maps/search/?api=1&query=40.67,-73.97',
    );
  });

  it('renders nothing for the POI section when pois is empty', () => {
    render(<RouteDetailPanel route={routeWithPois([])} onClose={vi.fn()} />);
    expect(screen.queryByRole('link', { name: /google maps/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('poi-section')).not.toBeInTheDocument();
  });

  it('renders nothing for the POI section when pois is undefined', () => {
    render(<RouteDetailPanel route={route} onClose={vi.fn()} />);
    expect(screen.queryByTestId('poi-section')).not.toBeInTheDocument();
  });
});
