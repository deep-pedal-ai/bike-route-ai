import { Bike, Bookmark } from 'lucide-react';
import { NavLink } from 'react-router-dom';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `text-sm font-medium transition-colors duration-200 ${
    isActive ? 'text-[var(--color-leaf)]' : 'text-zinc-400 hover:text-zinc-200'
  }`;

export default function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--color-bark-border)] bg-[var(--color-forest)]/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-leaf)]">
            <Bike className="h-5 w-5 text-[var(--color-forest)]" strokeWidth={2.5} />
          </div>
          <span className="text-lg font-bold tracking-tight text-zinc-100">
            VeloMind<span className="text-[var(--color-leaf)]">AI</span>
          </span>
          <span className="ml-1 rounded-full border border-[var(--color-leaf-border)] bg-[var(--color-leaf-wash)] px-2 py-0.5 text-xs font-medium text-[var(--color-leaf)]">
            MVP Preview
          </span>
        </div>

        <nav className="flex items-center gap-6">
          <NavLink to="/" end className={navLinkClass}>
            Generate
          </NavLink>
          <NavLink to="/map" className={navLinkClass}>
            Map
          </NavLink>

          <button className="flex items-center gap-2 rounded-lg border border-[var(--color-bark-border)] bg-[var(--color-bark-soft)] px-3 py-1.5 text-sm text-[var(--color-sage-text)] transition-all duration-200 hover:border-[var(--color-leaf)] hover:text-[var(--color-cream)]">
            <Bookmark className="h-4 w-4" />
            <span className="hidden sm:inline">Saved Routes</span>
          </button>
        </nav>
      </div>
    </header>
  );
}
