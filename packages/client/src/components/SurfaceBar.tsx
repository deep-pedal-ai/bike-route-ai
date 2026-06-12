import type { Surface } from '../types/route';

type SurfaceBarProps = {
  surfaces: Surface[];
};

const SURFACE_COLORS: Record<string, string> = {
  Gravel: 'bg-[var(--color-trail)]',
  Road: 'bg-[var(--color-river)]',
  Paved: 'bg-[var(--color-leaf)]',
  'Paved Path': 'bg-[var(--color-leaf)]',
  Path: 'bg-[var(--color-leaf)]',
  Asphalt: 'bg-[var(--color-leaf)]',
  Concrete: 'bg-[var(--color-river)]',
  Unpaved: 'bg-[var(--color-clay)]',
  Singletrack: 'bg-[var(--color-clay)]',
};

const SURFACE_DOT_COLORS: Record<string, string> = {
  Gravel: 'bg-[var(--color-trail)]',
  Road: 'bg-[var(--color-river)]',
  Paved: 'bg-[var(--color-leaf)]',
  'Paved Path': 'bg-[var(--color-leaf)]',
  Path: 'bg-[var(--color-leaf)]',
  Asphalt: 'bg-[var(--color-leaf)]',
  Concrete: 'bg-[var(--color-river)]',
  Unpaved: 'bg-[var(--color-clay)]',
  Singletrack: 'bg-[var(--color-clay)]',
};

export default function SurfaceBar({ surfaces }: SurfaceBarProps) {
  if (surfaces.length === 0) {
    return <p className="text-sm text-zinc-500">Surface data unavailable</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-zinc-800">
        {surfaces.map((s) => (
          <div
            key={s.label}
            className={`${SURFACE_COLORS[s.label] ?? 'bg-zinc-500'} transition-all duration-500`}
            style={{ width: `${Math.max(0, Math.min(100, s.percentage))}%` }}
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
