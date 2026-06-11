import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import LoadingSkeleton from './LoadingSkeleton';

describe('LoadingSkeleton', () => {
  it('renders without crashing', () => {
    const { container: c } = render(<LoadingSkeleton />);
    expect(c.firstChild).toBeInTheDocument();
  });

  it('applies animate-pulse class', () => {
    const { container: c } = render(<LoadingSkeleton />);
    expect(c.firstChild).toHaveClass('animate-pulse');
  });
});
