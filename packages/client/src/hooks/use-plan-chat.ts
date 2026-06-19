import { useRef, useState } from 'react';

import { streamChat } from '../api/chat';

export type PlanMessage = {
  role: 'user' | 'assistant';
  content: string;
  images?: string[];
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
  // Stable per-conversation id sent with every turn so the server threads this
  // chat's memory together — follow-ups like "now add a stop in X" build on the
  // route already planned. `reset` starts a fresh conversation (new id).
  const conversationIdRef = useRef<string>(crypto.randomUUID());

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
      for await (const chunk of streamChat(trimmed, {
        conversationId: conversationIdRef.current,
        signal: controller.signal,
      })) {
        if (chunk.type === 'token') {
          setMessages((current) => appendToken(current, chunk.value));
        } else if (chunk.type === 'image') {
          setMessages((current) => appendImage(current, chunk.url));
        }
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
    conversationIdRef.current = crypto.randomUUID();
    setMessages([]);
    setError(null);
    setIsStreaming(false);
  };

  return { messages, isStreaming, error, ask, reset };
}

// Returns a new array with `token` appended to the final (in-flight assistant)
// message's content.
function appendToken(messages: PlanMessage[], token: string): PlanMessage[] {
  if (messages.length === 0) return messages;
  const last = messages[messages.length - 1];
  return [...messages.slice(0, -1), { ...last, content: last.content + token }];
}

// Returns a new array with `url` appended to the final (in-flight assistant)
// message's image list.
function appendImage(messages: PlanMessage[], url: string): PlanMessage[] {
  if (messages.length === 0) return messages;
  const last = messages[messages.length - 1];
  return [...messages.slice(0, -1), { ...last, images: [...(last.images ?? []), url] }];
}
