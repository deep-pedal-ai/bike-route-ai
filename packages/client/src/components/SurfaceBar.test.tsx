import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SurfaceBar from './SurfaceBar';

describe('SurfaceBar', () => {
  it('renders all surface labels', () => {
    render(
      <SurfaceBar
        surfaces={[
          { label: 'Gravel', percentage: 70 },
          { label: 'Road', percentage: 30 },
        ]}
      />
    );
    expect(screen.getByText('Gravel')).toBeInTheDocument();
    expect(screen.getByText('Road')).toBeInTheDocument();
  });

  it('renders percentage values', () => {
    render(
      <SurfaceBar
        surfaces={[
          { label: 'Gravel', percentage: 70 },
          { label: 'Road', percentage: 30 },
        ]}
      />
    );
    expect(screen.getByText('70%')).toBeInTheDocument();
    expect(screen.getByText('30%')).toBeInTheDocument();
  });

  it('renders a single 100% surface', () => {
    render(<SurfaceBar surfaces={[{ label: 'Road', percentage: 100 }]} />);
    expect(screen.getByText('Road')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('renders unknown surface labels without crashing', () => {
    render(<SurfaceBar surfaces={[{ label: 'Cobblestone', percentage: 100 }]} />);
    expect(screen.getByText('Cobblestone')).toBeInTheDocument();
  });
});
