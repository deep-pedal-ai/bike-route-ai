import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Legend from './Legend';

const sourceSwatches = [
  { label: 'osm_relation', color: '#3b82f6' },
  { label: 'canon', color: '#22c55e' },
  { label: 'generated', color: '#f59e0b' },
  { label: 'nysdot', color: '#a855f7' },
];

const qualityGradient = { from: '#ef4444', to: '#22c55e' };

const facilitySwatches = [
  { label: 'protected', color: '#16a34a' },
  { label: 'lane', color: '#2563eb' },
  { label: 'sharrow', color: '#f97316' },
  { label: 'greenway', color: '#14b8a6' },
  { label: 'other', color: '#71717a' },
];

describe('Legend', () => {
  it('renders one swatch and label per sourceSwatches entry in source mode', () => {
    render(
      <Legend
        mode="source"
        sourceSwatches={sourceSwatches}
        qualityGradient={qualityGradient}
        showFacilities={false}
      />
    );

    expect(screen.getAllByTestId('legend-swatch')).toHaveLength(sourceSwatches.length);
    for (const { label } of sourceSwatches) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('renders the gradient legend and no per-source swatches in quality mode', () => {
    render(
      <Legend
        mode="quality"
        sourceSwatches={sourceSwatches}
        qualityGradient={qualityGradient}
        showFacilities={false}
      />
    );

    expect(screen.getByTestId('legend-gradient')).toBeInTheDocument();
    expect(screen.queryAllByTestId('legend-swatch')).toHaveLength(0);
  });

  it('renders the 5 facility class entries when showFacilities is true', () => {
    render(
      <Legend
        mode="source"
        sourceSwatches={sourceSwatches}
        qualityGradient={qualityGradient}
        facilitySwatches={facilitySwatches}
        showFacilities
      />
    );

    expect(screen.getAllByTestId('legend-facility-swatch')).toHaveLength(5);
    for (const { label } of facilitySwatches) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('does not render facility entries when showFacilities is false', () => {
    render(
      <Legend
        mode="source"
        sourceSwatches={sourceSwatches}
        qualityGradient={qualityGradient}
        facilitySwatches={facilitySwatches}
        showFacilities={false}
      />
    );

    expect(screen.queryAllByTestId('legend-facility-swatch')).toHaveLength(0);
  });
});
