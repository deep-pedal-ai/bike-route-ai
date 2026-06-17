import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import RegionSwitcher from './RegionSwitcher';
import type { Region } from '../regions';

const REGIONS: Region[] = [
  {
    key: 'ny',
    label: 'New York',
    defaultView: { longitude: -73.95, latitude: 40.7, zoom: 10 },
    enabled: true,
  },
  {
    key: 'seattle',
    label: 'Seattle',
    defaultView: { longitude: -122.33, latitude: 47.61, zoom: 10 },
    enabled: false,
  },
];

describe('RegionSwitcher', () => {
  it('renders a pill per region from the list (not hardcoded)', () => {
    render(<RegionSwitcher regions={REGIONS} current="ny" onChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: /new york/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /seattle/i })).toBeInTheDocument();
  });

  it('marks the current region as pressed', () => {
    render(<RegionSwitcher regions={REGIONS} current="ny" onChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: /new york/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('disables a coming-soon (not enabled) region and never calls onChange for it', () => {
    const onChange = vi.fn();
    render(<RegionSwitcher regions={REGIONS} current="ny" onChange={onChange} />);

    const seattle = screen.getByRole('button', { name: /seattle/i });
    expect(seattle).toBeDisabled();

    fireEvent.click(seattle);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('calls onChange with the region key when an enabled, non-active pill is clicked', () => {
    const onChange = vi.fn();
    // Make Seattle enabled for this case so a non-active click is possible.
    const enabledRegions: Region[] = REGIONS.map((r) =>
      r.key === 'seattle' ? { ...r, enabled: true } : r,
    );
    render(<RegionSwitcher regions={enabledRegions} current="ny" onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: /seattle/i }));
    expect(onChange).toHaveBeenCalledWith('seattle');
  });

  it('does not call onChange when the already-active pill is clicked', () => {
    const onChange = vi.fn();
    render(<RegionSwitcher regions={REGIONS} current="ny" onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: /new york/i }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
