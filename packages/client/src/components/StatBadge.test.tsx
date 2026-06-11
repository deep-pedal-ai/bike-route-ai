import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatBadge from './StatBadge';

describe('StatBadge', () => {
  it('renders label and value', () => {
    render(<StatBadge icon={null} label="Distance" value="22 mi" />);
    expect(screen.getByText('Distance')).toBeInTheDocument();
    expect(screen.getByText('22 mi')).toBeInTheDocument();
  });

  it('applies accent styles when accent prop is true', () => {
    const { container } = render(<StatBadge icon={null} label="Distance" value="22 mi" accent />);
    expect(container.firstChild).toHaveClass('border-lime-400/30');
  });

  it('applies default styles when accent prop is false', () => {
    const { container } = render(<StatBadge icon={null} label="Distance" value="22 mi" />);
    expect(container.firstChild).toHaveClass('border-zinc-700/60');
  });

  it('renders the icon when provided', () => {
    render(<StatBadge icon={<span data-testid="icon" />} label="Distance" value="22 mi" />);
    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });
});
