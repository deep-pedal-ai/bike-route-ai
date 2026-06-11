import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import RouteResults from './RouteResults';
import { GRAVEL_ROUTE, ROAD_ROUTE, CASUAL_ROUTE } from '../data/mock-routes';

describe('RouteResults', () => {
  it('renders the route name', () => {
    render(<RouteResults route={GRAVEL_ROUTE} />);
    expect(screen.getByText('The Coffee & Crunch Loop')).toBeInTheDocument();
  });

  it('renders the route tagline', () => {
    render(<RouteResults route={GRAVEL_ROUTE} />);
    expect(screen.getByText(GRAVEL_ROUTE.tagline)).toBeInTheDocument();
  });

  it('renders distance stat', () => {
    render(<RouteResults route={GRAVEL_ROUTE} />);
    expect(screen.getByText('22 mi')).toBeInTheDocument();
  });

  it('renders elevation stat', () => {
    render(<RouteResults route={GRAVEL_ROUTE} />);
    expect(screen.getByText('1,200 ft')).toBeInTheDocument();
  });

  it('renders estimated time', () => {
    render(<RouteResults route={GRAVEL_ROUTE} />);
    expect(screen.getByText('2h 15m')).toBeInTheDocument();
  });

  it('renders difficulty badge', () => {
    render(<RouteResults route={GRAVEL_ROUTE} />);
    expect(screen.getAllByText('Moderate').length).toBeGreaterThan(0);
  });

  it('renders the overview text', () => {
    render(<RouteResults route={GRAVEL_ROUTE} />);
    expect(screen.getByText(GRAVEL_ROUTE.overview)).toBeInTheDocument();
  });

  it('renders all turn-by-turn steps', () => {
    render(<RouteResults route={GRAVEL_ROUTE} />);
    GRAVEL_ROUTE.turns.forEach((turn) => {
      expect(screen.getByText(turn.instruction)).toBeInTheDocument();
    });
  });

  it('renders all gear tips', () => {
    render(<RouteResults route={GRAVEL_ROUTE} />);
    GRAVEL_ROUTE.gearTips.forEach((tip) => {
      expect(screen.getByText(tip)).toBeInTheDocument();
    });
  });

  it('renders road route correctly', () => {
    render(<RouteResults route={ROAD_ROUTE} />);
    expect(screen.getByText('The Coastal Roller Coaster')).toBeInTheDocument();
    expect(screen.getByText('45 mi')).toBeInTheDocument();
  });

  it('renders casual route correctly', () => {
    render(<RouteResults route={CASUAL_ROUTE} />);
    expect(screen.getByText('Greenway Explorer')).toBeInTheDocument();
    expect(screen.getByText('12 mi')).toBeInTheDocument();
  });
});
