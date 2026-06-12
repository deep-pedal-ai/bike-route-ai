import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { RouteSearchResult } from '@bike-route-ai/shared';
import RouteResults from './RouteResults';

const RESULTS: RouteSearchResult[] = [
  {
    id: 'greenway',
    name: 'Shelby Bottoms Greenway',
    distanceKm: 20,
    ascentM: 80,
    isLoop: true,
    qualityScore: 0.91,
    surfaceBreakdown: { paved: 1 },
    blurb: 'Flat, paved, and mostly separated from traffic.',
  },
  {
    id: 'ridge',
    name: 'Percy Warner Ridge',
    distanceKm: 42,
    ascentM: null,
    isLoop: false,
    qualityScore: null,
    surfaceBreakdown: { gravel: 0.6, paved: 0.4 },
    blurb: 'Mixed surface riding with a hillier feel.',
  },
];

describe('RouteResults', () => {
  it('renders ranked route cards', () => {
    render(<RouteResults results={RESULTS} filtersRelaxed={false} />);

    expect(screen.getByText('Shelby Bottoms Greenway')).toBeInTheDocument();
    expect(screen.getByText('Percy Warner Ridge')).toBeInTheDocument();
    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByText('#2')).toBeInTheDocument();
  });

  it('renders grounded route facts', () => {
    render(<RouteResults results={RESULTS} filtersRelaxed={false} />);

    expect(screen.getByText('12 mi / 20.0 km')).toBeInTheDocument();
    expect(screen.getByText('262 ft')).toBeInTheDocument();
    expect(screen.getByText('No data')).toBeInTheDocument();
    expect(screen.getByText('Loop')).toBeInTheDocument();
    expect(screen.getByText('Not a loop')).toBeInTheDocument();
  });

  it('renders surface breakdowns', () => {
    render(<RouteResults results={RESULTS} filtersRelaxed={false} />);

    expect(screen.getAllByText('Paved')).toHaveLength(2);
    expect(screen.getByText('Gravel')).toBeInTheDocument();
    expect(screen.getAllByText('60%')).toHaveLength(1);
  });

  it('renders relaxed-filter notice', () => {
    render(<RouteResults results={RESULTS} filtersRelaxed={true} />);
    expect(screen.getByText(/No exact route satisfied/)).toBeInTheDocument();
  });

  it('renders empty corpus state', () => {
    render(<RouteResults results={[]} filtersRelaxed={false} />);
    expect(screen.getByText('No routes found in the corpus.')).toBeInTheDocument();
  });
});
