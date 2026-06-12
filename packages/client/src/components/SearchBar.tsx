import { Zap, Loader2 } from 'lucide-react';

interface SearchBarProps {
  query: string;
  onQueryChange: (value: string) => void;
  onGenerate: () => void;
  isLoading: boolean;
}

export default function SearchBar({ query, onQueryChange, onGenerate, isLoading }: SearchBarProps) {
  return (
    <div className="relative w-full">
      <div className="rounded-2xl border border-zinc-700/60 bg-zinc-900/80 p-1 shadow-2xl shadow-black/40 transition-all duration-200 focus-within:border-lime-400/50 focus-within:shadow-lime-400/5">
        <textarea
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') onGenerate();
          }}
          placeholder="Find me a 20-mile gravel loop with a coffee shop stop and scenic ridge views..."
          rows={3}
          className="w-full resize-none rounded-xl bg-transparent px-4 pb-2 pt-4 text-base text-zinc-100 placeholder-zinc-600 focus:outline-none"
        />
        <div className="flex items-center justify-between px-4 pb-3">
          <span className="text-xs text-zinc-600">
            {query.length > 0 ? `${query.length} chars` : ''}
          </span>
          <button
            onClick={onGenerate}
            disabled={isLoading || query.trim().length === 0}
            className="flex items-center gap-2 rounded-xl bg-lime-400 px-5 py-2.5 text-sm font-semibold text-zinc-950 transition-all duration-200 hover:bg-lime-300 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Zap className="h-4 w-4" strokeWidth={2.5} />
            )}
            {isLoading ? 'Searching…' : 'Search Routes'}
          </button>
        </div>
      </div>
    </div>
  );
}
