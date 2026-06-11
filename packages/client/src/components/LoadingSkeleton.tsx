export default function LoadingSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 space-y-3">
            <div className="flex gap-2">
              <div className="h-5 w-24 rounded-full bg-zinc-800" />
              <div className="h-5 w-20 rounded-full bg-zinc-800" />
            </div>
            <div className="h-8 w-3/4 rounded-xl bg-zinc-800" />
            <div className="h-4 w-full rounded-lg bg-zinc-800/70" />
            <div className="h-4 w-2/3 rounded-lg bg-zinc-800/70" />
          </div>
          <div className="h-16 w-16 flex-shrink-0 rounded-2xl bg-zinc-800" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <div className="h-3 w-16 rounded-full bg-zinc-800" />
            <div className="h-7 w-20 rounded-lg bg-zinc-800" />
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
            <div className="h-4 w-24 rounded-full bg-zinc-800" />
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className={`h-3 rounded-lg bg-zinc-800/70 ${i === 4 ? 'w-3/4' : 'w-full'}`} />
            ))}
          </div>
          <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
            <div className="h-4 w-32 rounded-full bg-zinc-800" />
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="h-8 w-12 rounded-lg bg-zinc-800" />
                <div className={`h-3 rounded-lg bg-zinc-800/70 ${i % 2 === 0 ? 'w-2/3' : 'w-1/2'}`} />
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-4">
          <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
            <div className="h-4 w-24 rounded-full bg-zinc-800" />
            <div className="h-2.5 w-full rounded-full bg-zinc-800" />
            <div className="h-3 w-32 rounded-lg bg-zinc-800/70" />
          </div>
          <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
            <div className="h-4 w-32 rounded-full bg-zinc-800" />
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className={`h-3 rounded-lg bg-zinc-800/70 ${i === 3 ? 'w-3/4' : 'w-full'}`} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
