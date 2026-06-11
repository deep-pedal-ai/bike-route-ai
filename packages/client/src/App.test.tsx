import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';

describe('App', () => {
  it('renders the hero heading', () => {
    render(<App />);
    expect(screen.getByText('ride')).toBeInTheDocument();
  });

  it('renders the generate button', () => {
    render(<App />);
    expect(screen.getByText('Generate Route')).toBeInTheDocument();
  });

  it('renders the quick query pills', () => {
    render(<App />);
    expect(screen.getByText('Gravel + Coffee')).toBeInTheDocument();
    expect(screen.getByText('Coastal Road Ride')).toBeInTheDocument();
    expect(screen.getByText('Easy Path Cruise')).toBeInTheDocument();
  });
});
