import type { ReactNode } from 'react';
import { Mountain, Waves, Leaf } from 'lucide-react';

type QuickQuery = {
  label: string;
  query: string;
  icon: ReactNode;
};

const QUICK_QUERIES: QuickQuery[] = [
  {
    label: 'Hilly Gravel',
    query: 'Hilly gravel loop away from traffic around 35 km',
    icon: <Mountain className="h-3.5 w-3.5" />,
  },
  {
    label: 'Long Road Loop',
    query: 'Long paved road loop with steady climbing',
    icon: <Waves className="h-3.5 w-3.5" />,
  },
  {
    label: 'Flat Greenway',
    query: 'Flat mostly paved greenway ride away from traffic around 20 km',
    icon: <Leaf className="h-3.5 w-3.5" />,
  },
];

type QuickQueriesProps = {
  onSelect: (query: string) => void;
  disabled: boolean;
};

export default function QuickQueries({ onSelect, disabled }: QuickQueriesProps) {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      <span className="mb-1 w-full text-center text-xs text-[var(--color-moss-muted)]">Common rides</span>
      {QUICK_QUERIES.map((q) => (
        <button
          key={q.label}
          onClick={() => onSelect(q.query)}
          disabled={disabled}
          className="flex items-center gap-1.5 rounded-full border border-[var(--color-bark-border)] bg-[var(--color-bark-soft)] px-3.5 py-1.5 text-xs font-medium text-[var(--color-moss-muted)] transition-all duration-200 hover:border-[var(--color-leaf-border)] hover:bg-[var(--color-leaf-wash)] hover:text-[var(--color-sage-text)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {q.icon}
          {q.label}
        </button>
      ))}
    </div>
  );
}
