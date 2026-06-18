import { useState } from 'react';
import { AlertTriangle, Bike, Sparkles } from 'lucide-react';
import SearchBar from '../components/SearchBar';
import QuickQueries from '../components/QuickQueries';
import LoadingSkeleton from '../components/LoadingSkeleton';
import RouteResults from '../components/RouteResults';
import Conversation from '../components/Conversation';
import ChatInput from '../components/ChatInput';
import { useRouteSearch } from '../hooks/use-route-search';
import { usePlanChat } from '../hooks/use-plan-chat';

export default function GeneratePage() {
  const { query, setQuery, isLoading, results, filtersRelaxed, error, search } =
    useRouteSearch();
  const planChat = usePlanChat();

  const [planMode, setPlanMode] = useState(false);

  const handleGenerate = () => search(query);

  const handlePlan = () => {
    setPlanMode(true);
    setQuery('');
    planChat.reset();
  };

  const handleQuickSelect = (q: string) => {
    setQuery(q);
    search(q);
  };

  // Sends the current input to the Planning Agent and clears the field; the
  // reply streams into the conversation transcript.
  const handleSend = () => {
    planChat.ask(query);
    setQuery('');
  };

  const busy = planMode ? planChat.isStreaming : isLoading;

  // Plan mode uses a dedicated split layout: a chat pane on the right (the
  // conversation transcript above a one-line input) with the heading and intro
  // stacked in the remaining space on the left.
  if (planMode) {
    return (
      <main key="agent-view" className="view-motion px-12 pb-8">
        <div className="flex gap-8">
          <div className="flex flex-1 flex-col gap-8 py-12">
            <div>
              <span className="mb-6 inline-flex items-center gap-2 rounded-full bg-[var(--color-leaf)] px-4 py-1.5 text-xs font-semibold text-[var(--color-forest)]">
                <Sparkles className="h-3.5 w-3.5" strokeWidth={2.5} />
                Planning Agent
              </span>
              <h1 className="mb-4 text-4xl font-extrabold tracking-tight text-[var(--color-ink)] sm:text-5xl">
                Make your perfect<br /><span className="text-[var(--color-leaf)]">ride</span>
              </h1>
              <p className="text-base text-[var(--color-moss-muted)] sm:text-lg">
                craft the perfect route customized to you
              </p>
            </div>
          </div>

          <div className="flex h-[90vh] w-[60vw] flex-shrink-0 flex-col gap-3 py-12">
            <Conversation
              messages={planChat.messages}
              isStreaming={planChat.isStreaming}
              error={planChat.error}
            />
            <ChatInput value={query} onChange={setQuery} onSubmit={handleSend} isLoading={busy} />
            <p className="text-center text-xs text-[var(--color-moss-muted)] opacity-60">
              VeloMindAI's Planning Agent uses third party AI
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main key="regular-view" className="view-motion mx-auto max-w-5xl px-4 pb-24">

      {/* Hero */}
      <section className="py-16 text-center sm:py-24">
        <h1 className="mb-4 text-4xl font-extrabold tracking-tight text-[var(--color-ink)] sm:text-5xl lg:text-6xl">
          Find your perfect<br /><span className="text-[var(--color-leaf)]">ride</span>
        </h1>
        <p className="mb-10 text-base text-[var(--color-moss-muted)] sm:text-lg">
          Describe the ride you want and compare the closest real corpus routes.
        </p>

        <div className="mx-auto max-w-2xl space-y-4">
          <SearchBar
            query={query}
            onQueryChange={setQuery}
            onGenerate={handleGenerate}
            onPlan={handlePlan}
            planMode={planMode}
            isLoading={busy}
          />
          <QuickQueries onSelect={handleQuickSelect} disabled={busy} />
        </div>
      </section>

      {/* Route-search results */}
      {(isLoading || results || error) && (
        <section className="border-t border-[var(--color-bark-border)] pt-12">
          {isLoading && <LoadingSkeleton />}
          {!isLoading && error && (
            <div className="flex items-start gap-3 rounded-lg border border-[var(--color-danger-border)] bg-[var(--color-danger-wash)] p-4 text-sm text-[var(--color-danger)]">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--color-danger)]" />
              <p>{error}</p>
            </div>
          )}
          {!isLoading && results && <RouteResults results={results} filtersRelaxed={filtersRelaxed} />}
        </section>
      )}

      {/* Empty state */}
      {!isLoading && !results && !error && (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-[var(--color-bark-border)] bg-[var(--color-bark)]">
            <Bike className="h-8 w-8 text-[var(--color-moss-muted)]" />
          </div>
          <p className="text-sm text-[var(--color-moss-muted)]">Matching routes will appear here</p>
        </div>
      )}

    </main>
  );
}
