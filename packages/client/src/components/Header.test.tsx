import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Header from './Header';

describe('Header', () => {
  it('renders the app name', () => {
    render(<Header />);
    expect(screen.getByText('VeloMind')).toBeInTheDocument();
  });

  it('renders the MVP badge', () => {
    render(<Header />);
    expect(screen.getByText('MVP Preview')).toBeInTheDocument();
  });

  it('renders the saved routes button', () => {
    render(<Header />);
    expect(screen.getByText('Saved Routes')).toBeInTheDocument();
  });
});
