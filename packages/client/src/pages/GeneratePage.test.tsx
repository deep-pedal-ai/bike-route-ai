import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import GeneratePage from './GeneratePage';

describe('GeneratePage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the hero heading', () => {
    mockFetchSuccess();
    render(<GeneratePage />);
    expect(screen.getByText('ride')).toBeInTheDocument();
  });

  it('renders the search button', () => {
    mockFetchSuccess();
    render(<GeneratePage />);
    expect(screen.getByText('Search Routes')).toBeInTheDocument();
  });

  it('renders the quick query pills', () => {
    mockFetchSuccess();
    render(<GeneratePage />);
    expect(screen.getByText('Hilly Gravel')).toBeInTheDocument();
    expect(screen.getByText('Long Road Loop')).toBeInTheDocument();
    expect(screen.getByText('Flat Greenway')).toBeInTheDocument();
  });

  it('searches and renders returned route cards', async () => {
    const fetchMock = mockFetchSuccess({
      filtersRelaxed: false,
      results: [
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
      ],
    });
    render(<GeneratePage />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'flat paved loop' } });
    fireEvent.click(screen.getByText('Search Routes'));

    await waitFor(() => expect(screen.getByText('Shelby Bottoms Greenway')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith('/api/routes/search', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ query: 'flat paved loop' }),
    }));
  });

  it('shows relaxed-filter notice from the API response', async () => {
    mockFetchSuccess({
      filtersRelaxed: true,
      results: [
        {
          id: 'ridge',
          name: 'Closest Ridge Ride',
          distanceKm: 42,
          ascentM: 600,
          isLoop: true,
          qualityScore: null,
          surfaceBreakdown: null,
          blurb: 'Closest available match.',
        },
      ],
    });
    render(<GeneratePage />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '200 km loop' } });
    fireEvent.click(screen.getByText('Search Routes'));

    await waitFor(() => expect(screen.getByText(/No exact route satisfied/)).toBeInTheDocument());
  });

  it('shows an error state when search fails', async () => {
    mockFetchError('Search unavailable');
    render(<GeneratePage />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'quiet loop' } });
    fireEvent.click(screen.getByText('Search Routes'));

    await waitFor(() => expect(screen.getByText('Search unavailable')).toBeInTheDocument());
  });
});

function mockFetchSuccess(body: unknown = { results: [], filtersRelaxed: false }) {
  const fetchMock = vi.fn(async () => createJsonResponse(true, body)) as unknown as typeof fetch;
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function mockFetchError(message: string) {
  const fetchMock = vi.fn(async () => createJsonResponse(false, { error: message, statusCode: 500 })) as unknown as typeof fetch;
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function createJsonResponse(ok: boolean, body: unknown): Response {
  return {
    ok,
    json: async () => body,
  } as Response;
}
