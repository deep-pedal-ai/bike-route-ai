import { useEffect } from 'react';
import { X } from 'lucide-react';
import FilterBar from './FilterBar';
import Legend from './Legend';
import type { FilterState } from '../utils/maplibre-filter';

type ColorMode = 'source' | 'quality';
type Swatch = { label: string; color: string };

type FilterSheetProps = {
  open: boolean;
  onClose: () => void;
  filterState: FilterState;
  onFilterChange: (next: FilterState) => void;
  colorMode: ColorMode;
  onColorModeChange: (mode: ColorMode) => void;
  overlayOn: boolean;
  onOverlayChange: (on: boolean) => void;
  sourceSwatches: Swatch[];
  qualityGradient: { from: string; to: string };
  facilitySwatches: Swatch[];
};

// Mobile-only bottom sheet that re-homes the desktop filter panel's controls
// (FilterBar + facility overlay + Legend) behind a one-tap affordance, so the
// default mobile view stays map + search only. Esc and a backdrop tap close it.
export default function FilterSheet({
  open,
  onClose,
  filterState,
  onFilterChange,
  colorMode,
  onColorModeChange,
  overlayOn,
  onOverlayChange,
  sourceSwatches,
  qualityGradient,
  facilitySwatches,
}: FilterSheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 sm:hidden" role="dialog" aria-modal="true" aria-label="Map filters">
      <button
        type="button"
        aria-label="Close filters"
        onClick={onClose}
        className="absolute inset-0 bg-[rgba(16,20,15,0.55)] backdrop-blur-[2px]"
      />
      <div className="sheet-motion absolute inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-2xl border-t border-[var(--color-bark-border)] bg-[var(--color-forest)] p-4 shadow-[0_-18px_45px_rgba(16,20,15,0.5)]">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--color-cream)]">Filters & layers</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Done"
            className="flex h-11 w-11 items-center justify-center rounded-md border border-[var(--color-bark-border)] bg-[var(--color-bark-soft)] text-[var(--color-sage-text)] transition hover:text-[var(--color-cream)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-leaf)]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <FilterBar
          value={filterState}
          colorMode={colorMode}
          onChange={onFilterChange}
          onColorModeChange={onColorModeChange}
        />

        <label className="mt-3 flex items-center justify-between gap-3 rounded border border-[var(--color-bark-border)] bg-[var(--color-bark-soft)] px-3 py-2.5 text-xs text-[var(--color-sage-text)]">
          <span className="text-[11px] uppercase text-[var(--color-sage-text)]">
            Facility overlay
          </span>
          <input
            type="checkbox"
            checked={overlayOn}
            onChange={(e) => onOverlayChange(e.target.checked)}
            className="h-5 w-5 accent-[var(--color-leaf)]"
          />
        </label>

        <div className="mt-3">
          <Legend
            mode={colorMode}
            sourceSwatches={sourceSwatches}
            qualityGradient={qualityGradient}
            facilitySwatches={facilitySwatches}
            showFacilities={overlayOn}
          />
        </div>
      </div>
    </div>
  );
}
