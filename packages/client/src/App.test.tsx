import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import App from './App.tsx';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    json: () => Promise.resolve({ routes: [] }),
  }));
});

describe('App', () => {
  it('renders the heading', async () => {
    await act(async () => {
      render(<App />);
    });
    expect(screen.getByText('Bike Route AI')).toBeInTheDocument();
  });
});
