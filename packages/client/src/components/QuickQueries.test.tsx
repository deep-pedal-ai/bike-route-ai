import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import QuickQueries from './QuickQueries';

describe('QuickQueries', () => {
  it('renders all three quick query pills', () => {
    render(<QuickQueries onSelect={vi.fn()} disabled={false} />);
    expect(screen.getByText('Hilly Gravel')).toBeInTheDocument();
    expect(screen.getByText('Long Road Loop')).toBeInTheDocument();
    expect(screen.getByText('Flat Greenway')).toBeInTheDocument();
  });

  it('calls onSelect with the correct query when a pill is clicked', () => {
    const onSelect = vi.fn();
    render(<QuickQueries onSelect={onSelect} disabled={false} />);
    fireEvent.click(screen.getByText('Hilly Gravel'));
    expect(onSelect).toHaveBeenCalledWith(expect.stringContaining('gravel'));
  });

  it('disables all pills when disabled prop is true', () => {
    render(<QuickQueries onSelect={vi.fn()} disabled={true} />);
    const buttons = screen.getAllByRole('button');
    buttons.forEach((btn) => expect(btn).toBeDisabled());
  });
});
