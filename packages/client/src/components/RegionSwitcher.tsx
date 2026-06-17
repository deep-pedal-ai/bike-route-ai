import type { Region } from '../regions';

type RegionSwitcherProps = {
  // The list to render — RegionSwitcher is driven by this, never hardcoded
  // buttons, so adding a region is data, not code.
  regions: Region[];
  // The active region key.
  current: string;
  // Called with a region key when the user picks an enabled, non-active pill.
  onChange: (key: string) => void;
};

// Segmented pill control, top-left, distinct from the centered search bar.
// Disabled regions render as non-clickable "coming soon" pills so the partition
// is visible without enabling data that does not exist yet (Slice 1: NY only).
export default function RegionSwitcher({ regions, current, onChange }: RegionSwitcherProps) {
  return (
    <div
      role="group"
      aria-label="Region"
      className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-bark-border)] bg-[var(--color-forest-panel)] p-1 shadow-[0_12px_30px_rgba(16,20,15,0.42)] backdrop-blur-md"
    >
      {regions.map((region) => {
        const isActive = region.key === current;
        const disabled = !region.enabled;
        return (
          <button
            key={region.key}
            type="button"
            disabled={disabled}
            aria-pressed={isActive}
            aria-current={isActive ? 'true' : undefined}
            title={disabled ? `${region.label} — coming soon` : region.label}
            onClick={() => {
              if (!disabled && !isActive) onChange(region.key);
            }}
            className={[
              'rounded-md px-3 py-1.5 text-xs font-medium transition',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-leaf)]',
              isActive
                ? 'bg-[var(--color-leaf)] text-[var(--color-forest)]'
                : 'text-[var(--color-sage-text)] hover:text-[var(--color-cream)]',
              disabled ? 'cursor-not-allowed opacity-40' : '',
            ].join(' ')}
          >
            {region.label}
            {disabled && (
              <span className="ml-1 text-[9px] uppercase tracking-wide opacity-70">soon</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
