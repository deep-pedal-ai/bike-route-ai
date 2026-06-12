import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Header from './Header';

describe('Header', () => {
  it('renders the app name', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Header />
      </MemoryRouter>
    );
    expect(screen.getByText('VeloMind')).toBeInTheDocument();
  });

  it('renders the MVP badge', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Header />
      </MemoryRouter>
    );
    expect(screen.getByText('MVP Preview')).toBeInTheDocument();
  });

  it('renders the saved routes button', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Header />
      </MemoryRouter>
    );
    expect(screen.getByText('Saved Routes')).toBeInTheDocument();
  });

  it('renders Generate and Map nav links', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Header />
      </MemoryRouter>
    );
    expect(screen.getByRole('link', { name: 'Generate' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Map' })).toHaveAttribute('href', '/map');
  });

  it('marks the active link based on current location', () => {
    render(
      <MemoryRouter initialEntries={['/map']}>
        <Header />
      </MemoryRouter>
    );
    expect(screen.getByRole('link', { name: 'Map' })).toHaveClass('text-lime-400');
    expect(screen.getByRole('link', { name: 'Generate' })).not.toHaveClass('text-lime-400');
  });
});
