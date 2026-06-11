import { MapPin, TrendingUp, Timer, Map, ChevronRight, Lightbulb, Navigation, Sparkles, Award, Mountain } from 'lucide-react';
import type { RouteData, Difficulty } from '../types/route';
import StatBadge from './StatBadge';
import SurfaceBar from './SurfaceBar';

interface RouteResultsProps {
  route: RouteData;
}

const DIFFICULTY_STYLES: Record<Difficulty, string> = {
  Easy: 'text-emerald-400 border-emerald-400/30 bg-emerald-400/10',
  Moderate: 'text-amber-400 border-amber-400/30 bg-amber-400/10',
  Hard: 'text-orange-400 border-orange-400/30 bg-orange-400/10',
  Epic: 'text-red-400 border-red-400/30 bg-red-400/10',
};

export default function RouteResults({ route }: RouteResultsProps) {
  return (
    <div className="animate-fade-slide-up space-y-5">

      {/* Route header */}
      <div className="rounded-2xl border border-zinc-700/60 bg-zinc-900/60 p-6 shadow-xl shadow-black/20">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 rounded-full border border-lime-400/30 bg-lime-400/10 px-2.5 py-0.5 text-xs font-semibold text-lime-400">
                <Sparkles className="h-3 w-3" />
                AI Generated
              </span>
              <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${DIFFICULTY_STYLES[route.difficulty]}`}>
                {route.difficulty}
              </span>
            </div>
            <h2 className="mb-2 text-2xl font-bold tracking-tight text-zinc-100 sm:text-3xl">
              {route.name}
            </h2>
            <p className="text-sm leading-relaxed text-zinc-400">{route.tagline}</p>
          </div>
          <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl border border-lime-400/20 bg-lime-400/10 sm:h-16 sm:w-16">
            <Navigation className="h-7 w-7 text-lime-400 sm:h-8 sm:w-8" />
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatBadge icon={<Map className="h-3.5 w-3.5" />} label="Distance" value={`${route.distanceMiles} mi`} accent />
        <StatBadge icon={<TrendingUp className="h-3.5 w-3.5" />} label="Elevation" value={`${route.elevationFt.toLocaleString()} ft`} />
        <StatBadge icon={<Timer className="h-3.5 w-3.5" />} label="Est. Time" value={route.estimatedTime} />
        <StatBadge icon={<Award className="h-3.5 w-3.5" />} label="Difficulty" value={route.difficulty} />
      </div>

      {/* Content + sidebar */}
      <div className="grid gap-4 lg:grid-cols-3">

        {/* Main content */}
        <div className="space-y-4 lg:col-span-2">

          {/* Overview */}
          <section className="rounded-2xl border border-zinc-700/60 bg-zinc-900/60 p-6">
            <h3 className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              <MapPin className="h-3.5 w-3.5 text-lime-400" />
              Overview
            </h3>
            <p className="leading-relaxed text-zinc-300">{route.overview}</p>
            {route.highlights.length > 0 && (
              <ul className="mt-4 space-y-2.5">
                {route.highlights.map((h, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm text-zinc-400">
                    <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-lime-400" />
                    {h}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Turn-by-turn */}
          <section className="rounded-2xl border border-zinc-700/60 bg-zinc-900/60 p-6">
            <h3 className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              <ChevronRight className="h-3.5 w-3.5 text-lime-400" />
              Turn-by-Turn Highlights
            </h3>
            <div className="space-y-1">
              {route.turns.map((turn, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 rounded-xl p-3 transition-all duration-200 hover:bg-zinc-800/60"
                >
                  <span className="mt-0.5 flex-shrink-0 rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-0.5 font-mono text-xs font-medium text-zinc-400">
                    {turn.miles}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-zinc-200">{turn.instruction}</p>
                    {turn.note && (
                      <p className="mt-0.5 text-xs text-zinc-500">{turn.note}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

        </div>

        {/* Sidebar */}
        <div className="space-y-4">

          {/* Surface split */}
          <section className="rounded-2xl border border-zinc-700/60 bg-zinc-900/60 p-6">
            <h3 className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              <Mountain className="h-3.5 w-3.5 text-lime-400" />
              Surface Split
            </h3>
            <SurfaceBar surfaces={route.surfaces} />
          </section>

          {/* Gear tips */}
          <section className="rounded-2xl border border-zinc-700/60 bg-zinc-900/60 p-6">
            <h3 className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              <Lightbulb className="h-3.5 w-3.5 text-lime-400" />
              Gear & Surface Tips
            </h3>
            <ul className="space-y-3">
              {route.gearTips.map((tip, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm text-zinc-400">
                  <span className="mt-1 flex-shrink-0 rounded-md bg-lime-400/10 p-1">
                    <span className="block h-1.5 w-1.5 rounded-full bg-lime-400" />
                  </span>
                  {tip}
                </li>
              ))}
            </ul>
          </section>

        </div>
      </div>
    </div>
  );
}
