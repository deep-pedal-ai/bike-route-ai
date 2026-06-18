import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import DistanceFilter from './DistanceFilter';

const KM_PER_MILE = 1.609344;

describe('DistanceFilter', () => {
  it('emits typed values as km when the unit is km (default)', () => {
    const onChange = vi.fn();
    render(<DistanceFilter onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Minimum distance'), {
      target: { value: '5' },
    });
    expect(onChange).toHaveBeenLastCalledWith({ minKm: 5, maxKm: undefined });

    fireEvent.change(screen.getByLabelText('Maximum distance'), {
      target: { value: '20' },
    });
    expect(onChange).toHaveBeenLastCalledWith({ minKm: undefined, maxKm: 20 });
  });

  // The load-bearing requirement: switching to miles must convert the typed
  // value to km before it leaves the component, so the map filter (and the DB
  // data behind it) stay in km — the toggle is display-only.
  it('converts a miles entry to km before emitting', () => {
    const onChange = vi.fn();
    render(<DistanceFilter onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: /switch to miles/i }));

    fireEvent.change(screen.getByLabelText('Minimum distance'), {
      target: { value: '5' },
    });
    expect(onChange).toHaveBeenLastCalledWith({
      minKm: 5 * KM_PER_MILE,
      maxKm: undefined,
    });
  });

  it('re-displays the stored km value in miles after toggling the unit', () => {
    // 8.04672 km == 5.00 mi; the input shows the converted, rounded value.
    render(<DistanceFilter minKm={5 * KM_PER_MILE} onChange={vi.fn()} />);

    const minInput = screen.getByLabelText('Minimum distance') as HTMLInputElement;
    expect(minInput.value).toBe('8.05');

    fireEvent.click(screen.getByRole('button', { name: /switch to miles/i }));
    expect(minInput.value).toBe('5');
  });

  it('clears the bound (undefined) when the field is emptied', () => {
    const onChange = vi.fn();
    render(<DistanceFilter minKm={10} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Minimum distance'), {
      target: { value: '' },
    });
    expect(onChange).toHaveBeenLastCalledWith({ minKm: undefined, maxKm: undefined });
  });
});
