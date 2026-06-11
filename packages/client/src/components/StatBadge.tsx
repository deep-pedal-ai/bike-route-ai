import type { ReactNode } from 'react';

interface StatBadgeProps {
  icon: ReactNode;
  label: string;
  value: string;
  accent?: boolean;
}

export default function StatBadge({ icon, label, value, accent = false }: StatBadgeProps) {
  return (
    <div
      className={`flex flex-col gap-1.5 rounded-xl border p-4 transition-all duration-200 ${
        accent ? 'border-lime-400/30 bg-lime-400/5' : 'border-zinc-700/60 bg-zinc-800/40'
      }`}
    >
      <div
        className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider ${
          accent ? 'text-lime-400/80' : 'text-zinc-500'
        }`}
      >
        <span className={accent ? 'text-lime-400' : 'text-zinc-500'}>{icon}</span>
        {label}
      </div>
      <div className={`text-2xl font-bold tracking-tight ${accent ? 'text-lime-400' : 'text-zinc-100'}`}>
        {value}
      </div>
    </div>
  );
}
