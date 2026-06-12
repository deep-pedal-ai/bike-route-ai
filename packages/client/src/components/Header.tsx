import { Bike, Bookmark } from 'lucide-react';
import { NavLink } from 'react-router-dom';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `text-sm font-medium transition-colors duration-200 ${
    isActive ? 'text-lime-400' : 'text-zinc-400 hover:text-zinc-200'
  }`;

export default function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-zinc-800/60 bg-zinc-950/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-lime-400">
            <Bike className="h-5 w-5 text-zinc-950" strokeWidth={2.5} />
          </div>
          <span className="text-lg font-bold tracking-tight text-zinc-100">
            VeloMind<span className="text-lime-400">AI</span>
          </span>
          <span className="ml-1 rounded-full border border-lime-400/30 bg-lime-400/10 px-2 py-0.5 text-xs font-medium text-lime-400">
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

          <button className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-400 transition-all duration-200 hover:border-zinc-600 hover:text-zinc-200">
            <Bookmark className="h-4 w-4" />
            <span className="hidden sm:inline">Saved Routes</span>
          </button>
        </nav>
      </div>
    </header>
  );
}
