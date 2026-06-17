import { Zap, Loader2, Sparkles } from 'lucide-react';

type SearchBarProps = {
  query: string;
  onQueryChange: (value: string) => void;
  onGenerate: () => void;
  onPlan?: () => void;
  planMode?: boolean;
  isLoading: boolean;
};

export default function SearchBar({
  query,
  onQueryChange,
  onGenerate,
  onPlan,
  planMode = false,
  isLoading,
}: SearchBarProps) {
  return (
    <div className={`relative w-full ${planMode ? 'h-full' : ''}`}>
      <div
        className={`rounded-2xl border border-[var(--color-bark-border)] bg-[var(--color-bark-soft)] p-1 shadow-2xl shadow-black/30 transition-all duration-200 focus-within:border-[var(--color-leaf-border)] focus-within:shadow-[0_18px_42px_rgba(24,33,22,0.45)] ${
          // plan mode lets the card fill its container so the textarea can grow to full height
          planMode ? 'flex h-full flex-col' : ''
        }`}
      >
        <textarea
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') onGenerate();
          }}
          aria-label="Describe the route you're looking for"
          placeholder="Find me a 20-mile gravel loop with a coffee shop stop and scenic ridge views..."
          rows={3}
          className={`w-full resize-none rounded-xl bg-transparent px-4 pb-2 pt-4 text-base text-[var(--color-ink)] placeholder:text-[var(--color-moss-muted)] transition-all duration-200 focus:outline-none ${
            // plan mode grows the input to fill the tall right-hand pane
            planMode ? 'flex-1' : ''
          }`}
        />
        <div className="flex items-center justify-between px-4 pb-3">
          <div className="flex items-center gap-3">
            {onPlan && (
              <button
                onClick={onPlan}
                disabled={isLoading}
                className="flex items-center gap-2 rounded-xl border border-[var(--color-leaf-border)] bg-[var(--color-leaf-wash)] px-4 py-2.5 text-sm font-semibold text-[var(--color-sage-text)] transition-all duration-200 hover:bg-[var(--color-leaf-wash)]/80 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Sparkles className="h-4 w-4 text-[var(--color-leaf)]" strokeWidth={2.5} />
                Plan
              </button>
            )}
            <span className="text-xs text-[var(--color-moss-muted)]">
              {query.length > 0 ? `${query.length} chars` : ''}
            </span>
          </div>
          <button
            onClick={onGenerate}
            disabled={isLoading || query.trim().length === 0}
            className="flex items-center gap-2 rounded-xl bg-[var(--color-leaf)] px-5 py-2.5 text-sm font-semibold text-[var(--color-forest)] transition-all duration-200 hover:bg-[var(--color-leaf-hover)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : planMode ? (
              <Sparkles className="h-4 w-4" strokeWidth={2.5} />
            ) : (
              <Zap className="h-4 w-4" strokeWidth={2.5} />
            )}
            {isLoading ? (planMode ? 'Asking…' : 'Searching…') : planMode ? 'Ask' : 'Search Routes'}
          </button>
        </div>
      </div>
    </div>
  );
}
