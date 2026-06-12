import type { ChangeEvent } from 'react';

export type FilterState = {
  sources: string[];
  minKm?: number;
  maxKm?: number;
  loopOnly?: boolean;
  minQuality?: number;
};

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
    key: 'minKm' | 'maxKm' | 'minQuality',
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const raw = event.target.value;
    onChange({ ...value, [key]: raw === '' ? undefined : Number(raw) });
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
                  ? 'border-lime-300 bg-lime-300 text-zinc-950 shadow-[0_0_18px_rgba(190,242,100,0.35)]'
                  : 'border-zinc-700/80 bg-zinc-950/70 text-zinc-400 hover:border-zinc-500 hover:text-zinc-100',
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
            className="h-8 w-full rounded border border-zinc-700/80 bg-zinc-950/80 px-2 font-mono text-sm text-zinc-100 outline-none transition focus:border-lime-300"
          />
        </label>

        <label className="space-y-1">
          <span className="block text-[10px] uppercase text-zinc-500">Max km</span>
          <input
            type="number"
            aria-label="Max distance (km)"
            value={value.maxKm ?? ''}
            onChange={(event) => handleNumberChange('maxKm', event)}
            className="h-8 w-full rounded border border-zinc-700/80 bg-zinc-950/80 px-2 font-mono text-sm text-zinc-100 outline-none transition focus:border-lime-300"
          />
        </label>
      </div>

      <label className="flex items-center justify-between gap-3 rounded border border-zinc-800 bg-zinc-950/50 px-2 py-1.5">
        <span className="text-[11px] uppercase text-zinc-400">Loops only</span>
        <input
          type="checkbox"
          checked={value.loopOnly ?? false}
          onChange={handleLoopChange}
          className="h-4 w-4 accent-lime-300"
        />
      </label>

      <label className="space-y-1.5">
        <span className="flex items-center justify-between text-[10px] uppercase text-zinc-500">
          <span>Min quality</span>
          <span className="font-mono text-zinc-300">{value.minQuality ?? 0}</span>
        </span>
        <input
          type="range"
          min={0}
          max={100}
          value={value.minQuality ?? 0}
          onChange={(event) => handleNumberChange('minQuality', event)}
          className="w-full accent-lime-300"
        />
      </label>

      <button
        type="button"
        onClick={toggleColorMode}
        aria-label={`Color mode: ${colorMode}`}
        className="h-8 w-full rounded border border-zinc-700/80 bg-zinc-950/80 font-mono text-[11px] uppercase text-zinc-300 transition hover:border-lime-300 hover:text-lime-200"
      >
        Color / {colorMode}
      </button>
    </div>
  );
}
