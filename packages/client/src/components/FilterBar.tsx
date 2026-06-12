import type { ChangeEvent } from 'react';
import type { FilterState } from '../utils/maplibre-filter';

export type { FilterState } from '../utils/maplibre-filter';

type ColorMode = 'source' | 'quality';

type FilterBarProps = {
  value: FilterState;
  colorMode: ColorMode;
  onChange: (next: FilterState) => void;
  onColorModeChange: (mode: ColorMode) => void;
};

const SOURCES = ['osm_relation', 'canon', 'generated', 'nysdot'] as const;
const SOURCE_LABELS: Record<(typeof SOURCES)[number], string> = {
  osm_relation: 'OSM',
  canon: 'Canon',
  generated: 'Gen',
  nysdot: 'NYSDOT',
};

function qualityPercent(minQuality: number | undefined): number {
  return Math.round((minQuality ?? 0) * 100);
}

export default function FilterBar({
  value,
  colorMode,
  onChange,
  onColorModeChange,
}: FilterBarProps) {
  const toggleSource = (source: string) => {
    const nextSources = value.sources.includes(source)
      ? value.sources.filter((s) => s !== source)
      : [...value.sources, source];
    onChange({ ...value, sources: nextSources });
  };

  const handleNumberChange = (
    key: 'minKm' | 'maxKm',
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const raw = event.target.value;
    onChange({ ...value, [key]: raw === '' ? undefined : Number(raw) });
  };

  const handleQualityChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange({ ...value, minQuality: Number(event.target.value) / 100 });
  };

  const handleLoopChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange({ ...value, loopOnly: event.target.checked });
  };

  const toggleColorMode = () => {
    onColorModeChange(colorMode === 'source' ? 'quality' : 'source');
  };

  return (
    <div className="space-y-3 text-xs text-zinc-300">
      <div className="grid grid-cols-4 gap-1.5">
        {SOURCES.map((source) => {
          const active = value.sources.includes(source);
          return (
            <button
              key={source}
              type="button"
              onClick={() => toggleSource(source)}
              aria-pressed={active}
              aria-label={source}
              className={[
                'h-8 rounded border px-2 font-mono text-[11px] uppercase tracking-normal transition',
                active
                  ? 'border-[var(--color-leaf)] bg-[var(--color-leaf)] text-[var(--color-forest)]'
                  : 'border-[var(--color-bark-border)] bg-[var(--color-bark-soft)] text-[var(--color-sage-text)] hover:border-[var(--color-leaf)] hover:text-[var(--color-cream)]',
              ].join(' ')}
            >
              {SOURCE_LABELS[source]}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className="block text-[10px] uppercase text-zinc-500">Min km</span>
          <input
            type="number"
            aria-label="Min distance (km)"
            value={value.minKm ?? ''}
            onChange={(event) => handleNumberChange('minKm', event)}
            className="h-8 w-full rounded border border-[var(--color-bark-border)] bg-[var(--color-bark-soft)] px-2 font-mono text-sm text-[var(--color-cream)] outline-none transition focus:border-[var(--color-leaf)]"
          />
        </label>

        <label className="space-y-1">
          <span className="block text-[10px] uppercase text-zinc-500">Max km</span>
          <input
            type="number"
            aria-label="Max distance (km)"
            value={value.maxKm ?? ''}
            onChange={(event) => handleNumberChange('maxKm', event)}
            className="h-8 w-full rounded border border-[var(--color-bark-border)] bg-[var(--color-bark-soft)] px-2 font-mono text-sm text-[var(--color-cream)] outline-none transition focus:border-[var(--color-leaf)]"
          />
        </label>
      </div>

      <label className="flex items-center justify-between gap-3 rounded border border-[var(--color-bark-border)] bg-[var(--color-bark-soft)] px-2 py-1.5">
        <span className="text-[11px] uppercase text-[var(--color-sage-text)]">Loops only</span>
        <input
          type="checkbox"
          checked={value.loopOnly ?? false}
          onChange={handleLoopChange}
          className="h-4 w-4 accent-[var(--color-leaf)]"
        />
      </label>

      <label className="space-y-1.5">
        <span className="flex items-center justify-between text-[10px] uppercase text-[var(--color-moss-muted)]">
          <span>Min quality</span>
          <span className="font-mono text-[var(--color-sage-text)]">{qualityPercent(value.minQuality)}%</span>
        </span>
        <input
          type="range"
          min={0}
          max={100}
          value={qualityPercent(value.minQuality)}
          onChange={handleQualityChange}
          className="w-full accent-[var(--color-leaf)]"
        />
      </label>

      <button
        type="button"
        onClick={toggleColorMode}
        aria-label={`Color mode: ${colorMode}`}
        className="h-8 w-full rounded border border-[var(--color-bark-border)] bg-[var(--color-bark-soft)] font-mono text-[11px] uppercase text-[var(--color-sage-text)] transition hover:border-[var(--color-leaf)] hover:text-[var(--color-cream)]"
      >
        Color / {colorMode}
      </button>
    </div>
  );
}
