import { Loader2, Sparkles } from 'lucide-react';

type ChatInputProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
};

// Single-line plan-mode input. Enter (or the Ask button) submits; the button is
// disabled while a reply streams or the field is empty.
export default function ChatInput({ value, onChange, onSubmit, isLoading }: ChatInputProps) {
  const disabled = isLoading || value.trim().length === 0;

  return (
    <div className="flex items-center gap-2 rounded-2xl border border-[var(--color-bark-border)] bg-[var(--color-bark-soft)] p-1.5 shadow-2xl shadow-black/30 transition-all duration-200 focus-within:border-[var(--color-leaf-border)] focus-within:shadow-[0_18px_42px_rgba(24,33,22,0.45)]">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !disabled) onSubmit();
        }}
        aria-label="Ask the Planning Agent"
        placeholder="Ask the Planning Agent to plan your ride..."
        className="flex-1 bg-transparent px-3 py-2 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-moss-muted)] focus:outline-none"
      />
      <button
        onClick={onSubmit}
        disabled={disabled}
        className="flex flex-shrink-0 items-center gap-2 rounded-xl bg-[var(--color-leaf)] px-4 py-2 text-sm font-semibold text-[var(--color-forest)] transition-all duration-200 hover:bg-[var(--color-leaf-hover)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Sparkles className="h-4 w-4" strokeWidth={2.5} />
        )}
        Ask
      </button>
    </div>
  );
}
