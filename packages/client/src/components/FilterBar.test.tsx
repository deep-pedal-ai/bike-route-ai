import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import FilterBar from './FilterBar';

import type { FilterState } from './FilterBar';

const baseValue: FilterState = { sources: [] };

describe('FilterBar', () => {
  it('emits the source added to sources when an unselected chip is toggled', () => {
    const onChange = vi.fn();
    render(
      <FilterBar
        value={baseValue}
        colorMode="source"
        onChange={onChange}
        onColorModeChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /osm_relation/i }));

    expect(onChange).toHaveBeenCalledWith({ sources: ['osm_relation'] });
  });

  it('appends a newly toggled source to the end, preserving existing order', () => {
    const onChange = vi.fn();
    render(
      <FilterBar
        value={{ sources: ['canon'] }}
        colorMode="source"
        onChange={onChange}
        onColorModeChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /generated/i }));

    expect(onChange).toHaveBeenCalledWith({ sources: ['canon', 'generated'] });
  });

  it('removes a selected source from sources when its chip is toggled off', () => {
    const onChange = vi.fn();
    render(
      <FilterBar
        value={{ sources: ['osm_relation', 'nysdot'] }}
        colorMode="source"
        onChange={onChange}
        onColorModeChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /osm_relation/i }));

    expect(onChange).toHaveBeenCalledWith({ sources: ['nysdot'] });
  });

  it('preserves other filter fields when toggling a source', () => {
    const onChange = vi.fn();
    render(
      <FilterBar
        value={{ sources: [], minKm: 5, maxKm: 40, loopOnly: true, minQuality: 0.6 }}
        colorMode="source"
        onChange={onChange}
        onColorModeChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /canon/i }));

    expect(onChange).toHaveBeenCalledWith({
      sources: ['canon'],
      minKm: 5,
      maxKm: 40,
      loopOnly: true,
      minQuality: 0.6,
    });
  });

  it('emits a numeric minKm when the min distance input changes', () => {
    const onChange = vi.fn();
    render(
      <FilterBar
        value={baseValue}
        colorMode="source"
        onChange={onChange}
        onColorModeChange={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText(/min distance/i), {
      target: { value: '20' },
    });

    expect(onChange).toHaveBeenCalledWith({ sources: [], minKm: 20 });
  });

  it('emits a numeric maxKm when the max distance input changes', () => {
    const onChange = vi.fn();
    render(
      <FilterBar
        value={baseValue}
        colorMode="source"
        onChange={onChange}
        onColorModeChange={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText(/max distance/i), {
      target: { value: '50' },
    });

    expect(onChange).toHaveBeenCalledWith({ sources: [], maxKm: 50 });
  });

  it('emits minKm undefined when the min distance input is cleared', () => {
    const onChange = vi.fn();
    render(
      <FilterBar
        value={{ sources: [], minKm: 10 }}
        colorMode="source"
        onChange={onChange}
        onColorModeChange={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText(/min distance/i), {
      target: { value: '' },
    });

    expect(onChange).toHaveBeenCalledWith({ sources: [], minKm: undefined });
  });

  it('emits loopOnly true when the loop toggle is checked', () => {
    const onChange = vi.fn();
    render(
      <FilterBar
        value={baseValue}
        colorMode="source"
        onChange={onChange}
        onColorModeChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText(/loop/i));

    expect(onChange).toHaveBeenCalledWith({ sources: [], loopOnly: true });
  });

  it('emits loopOnly false when the loop toggle is unchecked', () => {
    const onChange = vi.fn();
    render(
      <FilterBar
        value={{ sources: [], loopOnly: true }}
        colorMode="source"
        onChange={onChange}
        onColorModeChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText(/loop/i));

    expect(onChange).toHaveBeenCalledWith({ sources: [], loopOnly: false });
  });

  it('emits normalized minQuality when the 0-100 quality slider changes', () => {
    const onChange = vi.fn();
    render(
      <FilterBar
        value={baseValue}
        colorMode="source"
        onChange={onChange}
        onColorModeChange={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText(/quality/i), {
      target: { value: '75' },
    });

    expect(onChange).toHaveBeenCalledWith({ sources: [], minQuality: 0.75 });
  });

  it('renders a normalized minQuality as a 0-100 percent slider value', () => {
    render(
      <FilterBar
        value={{ sources: [], minQuality: 0.6 }}
        colorMode="source"
        onChange={vi.fn()}
        onColorModeChange={vi.fn()}
      />,
    );

    expect(screen.getByText('60%')).toBeInTheDocument();
    expect(screen.getByLabelText(/quality/i)).toHaveValue('60');
  });

  it('flips color mode from source to quality', () => {
    const onColorModeChange = vi.fn();
    render(
      <FilterBar
        value={baseValue}
        colorMode="source"
        onChange={vi.fn()}
        onColorModeChange={onColorModeChange}
      />,
    );

    fireEvent.click(screen.getByLabelText(/color/i));

    expect(onColorModeChange).toHaveBeenCalledWith('quality');
  });

  it('flips color mode from quality to source', () => {
    const onColorModeChange = vi.fn();
    render(
      <FilterBar
        value={baseValue}
        colorMode="quality"
        onChange={vi.fn()}
        onColorModeChange={onColorModeChange}
      />,
    );

    fireEvent.click(screen.getByLabelText(/color/i));

    expect(onColorModeChange).toHaveBeenCalledWith('source');
  });
});
