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
    <div className="flex flex-wrap items-center gap-2">
      {SOURCES.map((source) => (
        <button
          key={source}
          type="button"
          onClick={() => toggleSource(source)}
          aria-pressed={value.sources.includes(source)}
        >
          {source}
        </button>
      ))}

      <label>
        Min distance (km)
        <input
          type="number"
          value={value.minKm ?? ''}
          onChange={(event) => handleNumberChange('minKm', event)}
        />
      </label>

      <label>
        Max distance (km)
        <input
          type="number"
          value={value.maxKm ?? ''}
          onChange={(event) => handleNumberChange('maxKm', event)}
        />
      </label>

      <label>
        Loops only
        <input
          type="checkbox"
          checked={value.loopOnly ?? false}
          onChange={handleLoopChange}
        />
      </label>

      <label>
        Min quality
        <input
          type="range"
          min={0}
          max={100}
          value={value.minQuality ?? 0}
          onChange={(event) => handleNumberChange('minQuality', event)}
        />
      </label>

      <button
        type="button"
        onClick={toggleColorMode}
        aria-label={`Color mode: ${colorMode}`}
      >
        Color: {colorMode}
      </button>
    </div>
  );
}
