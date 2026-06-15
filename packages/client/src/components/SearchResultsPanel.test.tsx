import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import SearchResultsPanel from './SearchResultsPanel';

import type { RouteSearchResult } from '@bike-route-ai/shared';

function result(id: string, name: string): RouteSearchResult {
  return {
    id,
    name,
    distanceKm: 20,
    ascentM: 100,
    isLoop: false,
    qualityScore: 0.7,
    surfaceBreakdown: { paved: 1 },
    blurb: `${name} blurb`,
  };
}

const mappable = result('286', 'Old Croton Aqueduct');
const unmappable = result('999', 'Phantom Route');

function renderPanel(overrides: Partial<React.ComponentProps<typeof SearchResultsPanel>> = {}) {
  const props = {
    results: [mappable, unmappable] as RouteSearchResult[] | null,
    mappableIds: new Set(['286']),
    filtersRelaxed: false,
    isLoading: false,
    error: null as string | null,
    onHover: vi.fn(),
    onSelect: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<SearchResultsPanel {...props} />);
  return props;
}

describe('SearchResultsPanel', () => {
  it('renders one card per result', () => {
    renderPanel();
    expect(screen.getByText('Old Croton Aqueduct')).toBeInTheDocument();
    expect(screen.getByText('Phantom Route')).toBeInTheDocument();
  });

  it('hovering a mappable card fires onHover(id), mouse-out fires onHover(null)', () => {
    const { onHover } = renderPanel();
    const card = screen.getByRole('button', { name: /focus old croton aqueduct/i });

    fireEvent.mouseEnter(card);
    expect(onHover).toHaveBeenCalledWith('286');

    fireEvent.mouseLeave(card);
    expect(onHover).toHaveBeenLastCalledWith(null);
  });

  it('clicking a mappable card fires onSelect(id)', () => {
    const { onSelect } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /focus old croton aqueduct/i }));
    expect(onSelect).toHaveBeenCalledWith('286');
  });

  it('selects on Enter and Space for keyboard users', () => {
    const { onSelect } = renderPanel();
    const card = screen.getByRole('button', { name: /focus old croton aqueduct/i });

    fireEvent.keyDown(card, { key: 'Enter' });
    fireEvent.keyDown(card, { key: ' ' });
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenCalledWith('286');
  });

  it('shows a "no map preview" hint for a result with no geometry and makes it non-interactive', () => {
    const { onSelect, onHover } = renderPanel();

    // The unmappable route is NOT exposed as a focus button.
    expect(
      screen.queryByRole('button', { name: /focus phantom route/i }),
    ).not.toBeInTheDocument();

    // It carries the informational hint instead.
    expect(screen.getByText(/no map preview/i)).toBeInTheDocument();

    // Interacting with its card body does nothing.
    const heading = screen.getByText('Phantom Route');
    fireEvent.click(heading);
    fireEvent.mouseEnter(heading);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onHover).not.toHaveBeenCalled();
  });

  it('fires onClose when the close button is clicked', () => {
    const { onClose } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /close search/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders the relaxed-filter notice only when filtersRelaxed', () => {
    const baseProps = {
      results: [mappable],
      mappableIds: new Set(['286']),
      isLoading: false,
      error: null,
      onHover: vi.fn(),
      onSelect: vi.fn(),
      onClose: vi.fn(),
    };
    const { rerender } = render(<SearchResultsPanel {...baseProps} filtersRelaxed={false} />);
    expect(screen.queryByText(/No exact route satisfied/i)).not.toBeInTheDocument();

    rerender(<SearchResultsPanel {...baseProps} filtersRelaxed />);
    expect(screen.getByText(/No exact route satisfied/i)).toBeInTheDocument();
  });

  it('shows the loading skeleton (and no cards) while a search is in flight', () => {
    renderPanel({ results: null, isLoading: true });
    expect(screen.queryByText('Old Croton Aqueduct')).not.toBeInTheDocument();
    expect(screen.getByText(/searching/i)).toBeInTheDocument();
  });

  it('shows the error state when the search failed', () => {
    renderPanel({ results: null, isLoading: false, error: 'Search unavailable' });
    expect(screen.getByText('Search unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Old Croton Aqueduct')).not.toBeInTheDocument();
  });

  it('shows an empty state when the search returned no routes', () => {
    renderPanel({ results: [], mappableIds: new Set() });
    expect(screen.getByText(/no routes matched/i)).toBeInTheDocument();
  });

  it('moves focus into the panel when it opens', () => {
    renderPanel();
    expect(screen.getByRole('complementary', { name: /route search results/i })).toHaveFocus();
  });

  it('marks the selected card with aria-current', () => {
    renderPanel({ selectedId: '286' });
    expect(screen.getByRole('button', { name: /focus old croton aqueduct/i })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });
});
