import type { ReactNode } from 'react';
import { Mountain, Waves, Leaf } from 'lucide-react';

interface QuickQuery {
  label: string;
  query: string;
  icon: ReactNode;
}

const QUICK_QUERIES: QuickQuery[] = [
  {
    label: 'Gravel + Coffee',
    query: 'Find me a gravel loop with a coffee stop and some technical fire road sections',
    icon: <Mountain className="h-3.5 w-3.5" />,
  },
  {
    label: 'Coastal Road Ride',
    query: 'Coastal road ride with big climbs, ocean views, endurance focused',
    icon: <Waves className="h-3.5 w-3.5" />,
  },
  {
    label: 'Easy Path Cruise',
    query: 'Easy casual flat path ride, recovery spin, nothing too hard',
    icon: <Leaf className="h-3.5 w-3.5" />,
  },
];

interface QuickQueriesProps {
  onSelect: (query: string) => void;
  disabled: boolean;
}

export default function QuickQueries({ onSelect, disabled }: QuickQueriesProps) {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      <span className="mb-1 w-full text-center text-xs text-zinc-600">Try a quick query →</span>
      {QUICK_QUERIES.map((q) => (
        <button
          key={q.label}
          onClick={() => onSelect(q.query)}
          disabled={disabled}
          className="flex items-center gap-1.5 rounded-full border border-zinc-700/60 bg-zinc-900/60 px-3.5 py-1.5 text-xs font-medium text-zinc-400 transition-all duration-200 hover:border-lime-400/40 hover:bg-lime-400/5 hover:text-lime-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {q.icon}
          {q.label}
        </button>
      ))}
    </div>
  );
}
