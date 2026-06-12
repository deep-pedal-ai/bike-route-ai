type Swatch = {
  label: string;
  color: string;
};

type LegendProps = {
  mode: 'source' | 'quality';
  sourceSwatches: Swatch[];
  qualityGradient: { from: string; to: string };
  facilitySwatches?: Swatch[];
  showFacilities: boolean;
};

export default function Legend({
  mode,
  sourceSwatches,
  qualityGradient,
  facilitySwatches,
  showFacilities,
}: LegendProps) {
  return (
    <div className="space-y-2">
      {mode === 'source' ? (
        <div className="flex flex-col gap-1.5">
          {sourceSwatches.map((s) => (
            <div key={s.label} className="flex items-center gap-2">
              <div
                data-testid="legend-swatch"
                className="h-3 w-3 rounded-sm"
                style={{ backgroundColor: s.color }}
              />
              <span className="text-xs text-zinc-400">{s.label}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-1">
          <div
            data-testid="legend-gradient"
            className="h-2.5 w-full rounded-full"
            style={{
              background: `linear-gradient(to right, ${qualityGradient.from}, ${qualityGradient.to})`,
            }}
          />
          <div className="flex justify-between text-xs text-zinc-500">
            <span>Low</span>
            <span>High</span>
          </div>
        </div>
      )}

      {showFacilities && facilitySwatches ? (
        <div className="flex flex-col gap-1.5 border-t border-zinc-800/60 pt-2">
          {facilitySwatches.map((f) => (
            <div key={f.label} className="flex items-center gap-2">
              <div
                data-testid="legend-facility-swatch"
                className="h-3 w-3 rounded-sm"
                style={{ backgroundColor: f.color }}
              />
              <span className="text-xs text-zinc-400">{f.label}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
