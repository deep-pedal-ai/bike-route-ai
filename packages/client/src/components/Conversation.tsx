import { useEffect, useRef } from 'react';
import { AlertTriangle, Sparkles } from 'lucide-react';

import type { PlanMessage } from '../hooks/use-plan-chat';

type ConversationProps = {
  messages: PlanMessage[];
  isStreaming: boolean;
  error: string | null;
};

// Renders the plan-mode chat transcript: user turns as right-aligned bubbles and
// assistant turns as labelled blocks. The latest assistant turn shows a pulsing
// caret while tokens are still streaming in.
export default function Conversation({ messages, isStreaming, error }: ConversationProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Keep the freshest tokens in view as the assistant streams.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, error]);

  if (messages.length === 0 && !error) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-2xl border border-[var(--color-bark-border)] bg-[var(--color-bark-soft)] p-5">
        <p className="text-center text-sm text-[var(--color-moss-muted)]">
          Ask the Planning Agent to start crafting your route.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto rounded-2xl border border-[var(--color-bark-border)] bg-[var(--color-bark-soft)] p-5">
      {messages.map((message, index) =>
        message.role === 'user' ? (
          <div key={index} className="flex justify-end">
            <p className="max-w-[80%] whitespace-pre-wrap rounded-2xl bg-[var(--color-leaf)] px-4 py-2 text-sm text-[var(--color-forest)]">
              {message.content}
            </p>
          </div>
        ) : (
          <div key={index} className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-sage-text)]">
              <Sparkles className="h-3.5 w-3.5 text-[var(--color-leaf)]" strokeWidth={2.5} />
              Planning Agent
            </div>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-ink)]">
              {message.content}
              {isStreaming && index === messages.length - 1 && (
                <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-[var(--color-leaf)] align-text-bottom" />
              )}
            </p>
            {message.images?.map((url, imageIndex) => (
              <img
                key={imageIndex}
                src={url}
                alt="Rendered route map"
                className="max-w-full rounded-lg border border-[var(--color-bark-border)]"
              />
            ))}
          </div>
        ),
      )}

      {error && (
        <div className="flex items-start gap-3 rounded-lg border border-[var(--color-danger-border)] bg-[var(--color-danger-wash)] p-4 text-sm text-[var(--color-danger)]">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--color-danger)]" />
          <p>{error}</p>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
