import { useRef, useState } from 'react';

import { streamChat } from '../api/chat';

export type PlanMessage = {
  role: 'user' | 'assistant';
  content: string;
};

// Plan-mode chat state machine. Holds the full conversation: each `ask` appends
// the user's turn plus an assistant turn whose content fills in as tokens
// stream. `isStreaming` is true from submit until the stream ends or errors. An
// in-flight stream is aborted when a new `ask` starts, so only the latest turn
// streams.
export type UsePlanChat = {
  messages: PlanMessage[];
  isStreaming: boolean;
  error: string | null;
  ask: (query: string) => Promise<void>;
  reset: () => void;
};

export function usePlanChat(): UsePlanChat {
  const [messages, setMessages] = useState<PlanMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const ask = async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed || isStreaming) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setError(null);
    setMessages((current) => [
      ...current,
      { role: 'user', content: trimmed },
      { role: 'assistant', content: '' },
    ]);
    setIsStreaming(true);

    try {
      for await (const token of streamChat(trimmed, { signal: controller.signal })) {
        setMessages((current) => appendToLast(current, token));
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : 'Chat request failed');
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setIsStreaming(false);
      }
    }
  };

  const reset = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([]);
    setError(null);
    setIsStreaming(false);
  };

  return { messages, isStreaming, error, ask, reset };
}

// Returns a new array with `token` appended to the final (in-flight assistant)
// message's content.
function appendToLast(messages: PlanMessage[], token: string): PlanMessage[] {
  if (messages.length === 0) return messages;
  const last = messages[messages.length - 1];
  return [...messages.slice(0, -1), { ...last, content: last.content + token }];
}
