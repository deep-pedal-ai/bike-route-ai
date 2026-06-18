import type { ChatRequest, ChatStreamEvent } from '@bike-route-ai/shared';

const CHAT_ENDPOINT = '/api/chat';

// POSTs a query to the streaming chat endpoint and yields assistant token
// deltas as they arrive. Mirrors the server's `ChatService.streamReply`
// contract: tokens are yielded, a `done` frame ends iteration, and an `error`
// frame (or a non-OK response) throws. Pass `signal` to abort an in-flight
// stream (e.g. on unmount) so we stop reading tokens the user no longer wants.
export async function* streamChat(
  query: string,
  options: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): AsyncGenerator<string> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(CHAT_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query } satisfies ChatRequest),
    signal: options.signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(await readErrorMessage(response));
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line; emit complete frames and keep
      // any trailing partial frame in the buffer for the next chunk.
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const event = parseFrame(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        if (event) {
          if (event.type === 'token') yield event.value;
          else if (event.type === 'done') return;
          else throw new Error(event.error);
        }
        boundary = buffer.indexOf('\n\n');
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// A frame is one or more `field: value` lines; we only care about `data:`,
// which carries the JSON-encoded ChatStreamEvent. Unparseable frames are
// skipped (returning null) rather than aborting the stream.
function parseFrame(frame: string): ChatStreamEvent | null {
  const dataLine = frame
    .split('\n')
    .find((line) => line.startsWith('data:'));
  if (!dataLine) return null;

  try {
    const parsed: unknown = JSON.parse(dataLine.slice('data:'.length).trim());
    return isChatStreamEvent(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isChatStreamEvent(value: unknown): value is ChatStreamEvent {
  if (typeof value !== 'object' || value === null) return false;
  const event = value as Record<string, unknown>;
  if (event.type === 'token') return typeof event.value === 'string';
  if (event.type === 'done') return true;
  if (event.type === 'error') return typeof event.error === 'string';
  return false;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null && typeof (body as Record<string, unknown>).error === 'string') {
      return (body as { error: string }).error;
    }
  } catch {
    // fall through to the generic message
  }
  return 'Chat request failed';
}
