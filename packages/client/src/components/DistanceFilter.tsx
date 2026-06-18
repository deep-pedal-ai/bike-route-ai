import { useState, type ChangeEvent } from 'react';

// Compact min/max distance filter that lives under the search input. The corpus
// stores route length in kilometres (`distance_km`), so the *stored* filter
// values are always km — the km/mi toggle is a frontend-only display unit. When
// the user is in miles, the typed value is converted to km before it reaches
// `filterState`, so the map filter (and the DB data behind it) never leave km.
const KM_PER_MILE = 1.609344;
type Unit = 'km' | 'mi';

type DistanceFilterProps = {
  // Stored bounds, always in km (undefined = no bound).
  minKm?: number;
  maxKm?: number;
  // Emits the next bounds in km; the changed field is converted from the active
  // display unit, the other is passed through unchanged.
  onChange: (next: { minKm?: number; maxKm?: number }) => void;
};

// km → active-unit display string, rounded to 2 decimals with trailing zeros
// dropped so a km↔mi conversion reads "12.43", not "12.4274016…". Display only;
// the stored km keeps full precision.
function display(km: number | undefined, unit: Unit): string {
  if (km === undefined) return '';
  const value = unit === 'mi' ? km / KM_PER_MILE : km;
  return String(Math.round(value * 100) / 100);
}

// active-unit input → km for storage. Empty / non-numeric clears the bound.
function toKm(raw: string, unit: Unit): number | undefined {
  if (raw.trim() === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return unit === 'mi' ? n * KM_PER_MILE : n;
}

export default function DistanceFilter({ minKm, maxKm, onChange }: DistanceFilterProps) {
  const [unit, setUnit] = useState<Unit>('km');
  // The inputs own their text as raw draft strings. If we re-derived the value
  // from km on every keystroke, the 2-decimal rounding in display() would
  // rewrite an in-progress entry (e.g. editing a converted "12.43" in miles)
  // and fight the cursor. km is only re-derived on a unit switch — the one
  // moment a conversion is actually wanted.
  const [minDraft, setMinDraft] = useState(() => display(minKm, 'km'));
  const [maxDraft, setMaxDraft] = useState(() => display(maxKm, 'km'));

  const handleMin = (event: ChangeEvent<HTMLInputElement>) => {
    setMinDraft(event.target.value);
    onChange({ minKm: toKm(event.target.value, unit), maxKm });
  };
  const handleMax = (event: ChangeEvent<HTMLInputElement>) => {
    setMaxDraft(event.target.value);
    onChange({ minKm, maxKm: toKm(event.target.value, unit) });
  };

  // Flip the display unit and reformat both drafts from the stored km, so the
  // shown numbers convert without disturbing the underlying filter.
  const toggleUnit = () => {
    const next: Unit = unit === 'km' ? 'mi' : 'km';
    setUnit(next);
    setMinDraft(display(minKm, next));
    setMaxDraft(display(maxKm, next));
  };

  // Subdued and near-invisible while empty so the row doesn't compete with the
  // search input; a value (or focus) brings the border + text up to legible.
  const fieldClass = (filled: boolean) =>
    [
      'h-9 w-16 rounded-lg border bg-transparent px-2 text-sm tabular-nums outline-none transition',
      // Hide the native number spinners — they steal width and clip values like
      // "12.43" in this compact field; the buttons add nothing for a filter.
      '[appearance:textfield] [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
      'placeholder:text-[var(--color-moss-muted)] focus:border-[var(--color-leaf-border)] focus:text-[var(--color-ink)]',
      filled
        ? 'border-[var(--color-bark-border)] text-[var(--color-ink)]'
        : 'border-transparent text-[var(--color-moss-muted)] hover:border-[var(--color-bark-border)]',
    ].join(' ');

  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        min={0}
        inputMode="decimal"
        aria-label="Minimum distance"
        placeholder="Min"
        value={minDraft}
        onChange={handleMin}
        className={fieldClass(minDraft !== '')}
      />
      <span className="text-[var(--color-moss-muted)]" aria-hidden="true">
        –
      </span>
      <input
        type="number"
        min={0}
        inputMode="decimal"
        aria-label="Maximum distance"
        placeholder="Max"
        value={maxDraft}
        onChange={handleMax}
        className={fieldClass(maxDraft !== '')}
      />
      <button
        type="button"
        onClick={toggleUnit}
        aria-label={`Distance unit: ${unit === 'km' ? 'kilometres' : 'miles'}. Switch to ${
          unit === 'km' ? 'miles' : 'kilometres'
        }.`}
        className="h-9 rounded-lg border border-[var(--color-bark-border)] px-2 text-xs font-medium uppercase text-[var(--color-sage-text)] transition hover:border-[var(--color-leaf-border)] hover:text-[var(--color-ink)]"
      >
        {unit}
      </button>
    </div>
  );
}
