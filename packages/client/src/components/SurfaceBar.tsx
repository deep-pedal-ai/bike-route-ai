import type { Surface } from '../types/route';

interface SurfaceBarProps {
  surfaces: Surface[];
}

const SURFACE_COLORS: Record<string, string> = {
  Gravel: 'bg-amber-500',
  Road: 'bg-blue-500',
  'Paved Path': 'bg-lime-400',
  Path: 'bg-lime-400',
  Singletrack: 'bg-orange-500',
};

const SURFACE_DOT_COLORS: Record<string, string> = {
  Gravel: 'bg-amber-500',
  Road: 'bg-blue-500',
  'Paved Path': 'bg-lime-400',
  Path: 'bg-lime-400',
  Singletrack: 'bg-orange-500',
};

export default function SurfaceBar({ surfaces }: SurfaceBarProps) {
  return (
    <div className="space-y-3">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-zinc-800">
        {surfaces.map((s) => (
          <div
            key={s.label}
            className={`${SURFACE_COLORS[s.label] ?? 'bg-zinc-500'} transition-all duration-500`}
            style={{ width: `${s.percentage}%` }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-3">
        {surfaces.map((s) => (
          <div key={s.label} className="flex items-center gap-1.5">
            <div className={`h-2.5 w-2.5 rounded-full ${SURFACE_DOT_COLORS[s.label] ?? 'bg-zinc-500'}`} />
            <span className="text-xs text-zinc-400">
              {s.label}{' '}
              <span className="font-semibold text-zinc-200">{s.percentage}%</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
