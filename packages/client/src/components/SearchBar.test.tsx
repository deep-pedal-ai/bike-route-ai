import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SearchBar from './SearchBar';

describe('SearchBar', () => {
  it('renders the textarea with placeholder', () => {
    render(<SearchBar query="" onQueryChange={vi.fn()} onGenerate={vi.fn()} isLoading={false} />);
    expect(screen.getByPlaceholderText(/gravel loop/i)).toBeInTheDocument();
  });

  it('calls onQueryChange when text is typed', () => {
    const onQueryChange = vi.fn();
    render(<SearchBar query="" onQueryChange={onQueryChange} onGenerate={vi.fn()} isLoading={false} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'gravel ride' } });
    expect(onQueryChange).toHaveBeenCalledWith('gravel ride');
  });

  it('calls onGenerate when button is clicked', () => {
    const onGenerate = vi.fn();
    render(<SearchBar query="gravel ride" onQueryChange={vi.fn()} onGenerate={onGenerate} isLoading={false} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onGenerate).toHaveBeenCalledOnce();
  });

  it('disables the button when query is empty', () => {
    render(<SearchBar query="" onQueryChange={vi.fn()} onGenerate={vi.fn()} isLoading={false} />);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('disables the button when loading', () => {
    render(<SearchBar query="gravel" onQueryChange={vi.fn()} onGenerate={vi.fn()} isLoading={true} />);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('shows "Searching…" text when loading', () => {
    render(<SearchBar query="gravel" onQueryChange={vi.fn()} onGenerate={vi.fn()} isLoading={true} />);
    expect(screen.getByText('Searching…')).toBeInTheDocument();
  });

  it('shows char count when query is non-empty', () => {
    render(<SearchBar query="hello" onQueryChange={vi.fn()} onGenerate={vi.fn()} isLoading={false} />);
    expect(screen.getByText('5 chars')).toBeInTheDocument();
  });

  it('calls onGenerate on Cmd+Enter', () => {
    const onGenerate = vi.fn();
    render(<SearchBar query="gravel" onQueryChange={vi.fn()} onGenerate={onGenerate} isLoading={false} />);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', metaKey: true });
    expect(onGenerate).toHaveBeenCalledOnce();
  });

  it('calls onGenerate on Ctrl+Enter', () => {
    const onGenerate = vi.fn();
    render(<SearchBar query="gravel" onQueryChange={vi.fn()} onGenerate={onGenerate} isLoading={false} />);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', ctrlKey: true });
    expect(onGenerate).toHaveBeenCalledOnce();
  });

  it('does not render the Plan button when onPlan is omitted', () => {
    render(<SearchBar query="gravel" onQueryChange={vi.fn()} onGenerate={vi.fn()} isLoading={false} />);
    expect(screen.queryByRole('button', { name: /plan/i })).not.toBeInTheDocument();
  });

  it('renders the Plan button and calls onPlan when clicked', () => {
    const onPlan = vi.fn();
    render(
      <SearchBar query="gravel" onQueryChange={vi.fn()} onGenerate={vi.fn()} onPlan={onPlan} isLoading={false} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /plan/i }));
    expect(onPlan).toHaveBeenCalledOnce();
  });

  it('enables the Plan button even when the query is empty', () => {
    render(<SearchBar query="" onQueryChange={vi.fn()} onGenerate={vi.fn()} onPlan={vi.fn()} isLoading={false} />);
    expect(screen.getByRole('button', { name: /plan/i })).toBeEnabled();
  });

  it('disables the Plan button while loading', () => {
    render(<SearchBar query="" onQueryChange={vi.fn()} onGenerate={vi.fn()} onPlan={vi.fn()} isLoading={true} />);
    expect(screen.getByRole('button', { name: /plan/i })).toBeDisabled();
  });

  it('shows the "Ask" CTA instead of "Search Routes" in plan mode', () => {
    render(
      <SearchBar query="gravel" onQueryChange={vi.fn()} onGenerate={vi.fn()} planMode isLoading={false} />,
    );
    expect(screen.getByRole('button', { name: /ask/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /search routes/i })).not.toBeInTheDocument();
  });

  it('shows "Asking…" text when loading in plan mode', () => {
    render(<SearchBar query="gravel" onQueryChange={vi.fn()} onGenerate={vi.fn()} planMode isLoading={true} />);
    expect(screen.getByText('Asking…')).toBeInTheDocument();
  });

  it('still calls onGenerate when the "Ask" CTA is clicked', () => {
    const onGenerate = vi.fn();
    render(
      <SearchBar query="gravel" onQueryChange={vi.fn()} onGenerate={onGenerate} planMode isLoading={false} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /ask/i }));
    expect(onGenerate).toHaveBeenCalledOnce();
  });
});
