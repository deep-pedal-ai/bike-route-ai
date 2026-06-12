export default function LoadingSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-5">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div className="flex-1 space-y-3">
              <div className="flex gap-2">
                <div className="h-6 w-12 rounded-full bg-zinc-800" />
                <div className="h-6 w-20 rounded-full bg-zinc-800" />
                <div className="h-6 w-24 rounded-full bg-zinc-800" />
              </div>
              <div className="h-7 w-2/3 rounded-lg bg-zinc-800" />
              <div className="h-4 w-full rounded-lg bg-zinc-800/70" />
              <div className="h-4 w-3/4 rounded-lg bg-zinc-800/70" />
            </div>
            <div className="h-12 w-12 flex-shrink-0 rounded-lg bg-zinc-800" />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="h-10 rounded-lg bg-zinc-800/70" />
            <div className="h-10 rounded-lg bg-zinc-800/70" />
            <div className="h-10 rounded-lg bg-zinc-800/70" />
          </div>
          <div className="mt-4 h-2.5 rounded-full bg-zinc-800" />
        </div>
      ))}
    </div>
  );
}
