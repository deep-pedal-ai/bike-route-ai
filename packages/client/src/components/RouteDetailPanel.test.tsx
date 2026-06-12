import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RouteDetailPanel from './RouteDetailPanel';
import { CORPUS_FIELD_DOCS } from '../corpus-field-docs';
import fixture from '../fixtures/corpus-sample.json';
import type { Feature, LineString } from 'geojson';
import type { CorpusRouteDetailProps } from '@bike-route-ai/shared';

const route = fixture.routeDetail as unknown as Feature<
  LineString,
  CorpusRouteDetailProps
>;

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
