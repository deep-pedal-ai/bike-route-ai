import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';

describe('App routing', () => {
  it('renders the Generate hero at /', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    );
    expect(screen.getByText('ride')).toBeInTheDocument();
    expect(screen.getByText('Generate Route')).toBeInTheDocument();
  });

  it('renders the quick query pills at /', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    );
    expect(screen.getByText('Gravel + Coffee')).toBeInTheDocument();
    expect(screen.getByText('Coastal Road Ride')).toBeInTheDocument();
    expect(screen.getByText('Easy Path Cruise')).toBeInTheDocument();
  });

  it('renders the MapExplorer placeholder at /map and not the hero', () => {
    render(
      <MemoryRouter initialEntries={['/map']}>
        <App />
      </MemoryRouter>
    );
    expect(screen.getByText('Explore the corpus')).toBeInTheDocument();
    expect(screen.queryByText('ride')).not.toBeInTheDocument();
  });

  it('switches view and active link when the Map nav link is clicked', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    );

    expect(screen.getByText('ride')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Generate' })).toHaveClass('text-lime-400');

    fireEvent.click(screen.getByRole('link', { name: 'Map' }));

    expect(screen.getByText('Explore the corpus')).toBeInTheDocument();
    expect(screen.queryByText('ride')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Map' })).toHaveClass('text-lime-400');
    expect(screen.getByRole('link', { name: 'Generate' })).not.toHaveClass('text-lime-400');
  });
});
