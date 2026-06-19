import { describe, it, expect, vi } from 'vitest';

import { streamChat } from './chat';

import type { ChatStreamEvent } from '@bike-route-ai/shared';

// Builds a Response whose body streams the given SSE chunks, mirroring the
// frame format the chat controller writes (event: line for non-token events).
function sseResponse(chunks: string[], init: { ok?: boolean } = {}): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return { ok: init.ok ?? true, body } as unknown as Response;
}

function frame(event: ChatStreamEvent): string {
  const prefix = event.type === 'token' ? '' : `event: ${event.type}\n`;
  return `${prefix}data: ${JSON.stringify(event)}\n\n`;
}

async function collect(query: string, fetchImpl: typeof fetch): Promise<string[]> {
  const tokens: string[] = [];
  for await (const chunk of streamChat(query, { fetchImpl })) {
    if (chunk.type === 'token') tokens.push(chunk.value);
  }
  return tokens;
}

describe('streamChat', () => {
  it('yields token values up to the done frame', async () => {
    const fetchImpl = vi.fn(async () =>
      sseResponse([
        frame({ type: 'token', value: 'Hello' }),
        frame({ type: 'token', value: ' world' }),
        frame({ type: 'done' }),
      ]),
    ) as unknown as typeof fetch;

    expect(await collect('hi', fetchImpl)).toEqual(['Hello', ' world']);
    expect(fetchImpl).toHaveBeenCalledWith('/api/chat', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ query: 'hi' }),
    }));
  });

  it('reassembles frames split across chunk boundaries', async () => {
    const full = frame({ type: 'token', value: 'split' }) + frame({ type: 'done' });
    const mid = Math.floor(full.length / 2);
    const fetchImpl = vi.fn(async () =>
      sseResponse([full.slice(0, mid), full.slice(mid)]),
    ) as unknown as typeof fetch;

    expect(await collect('hi', fetchImpl)).toEqual(['split']);
  });

  it('throws the message from an error frame', async () => {
    const fetchImpl = vi.fn(async () =>
      sseResponse([
        frame({ type: 'token', value: 'partial' }),
        frame({ type: 'error', error: 'Internal Server Error' }),
      ]),
    ) as unknown as typeof fetch;

    await expect(collect('hi', fetchImpl)).rejects.toThrow('Internal Server Error');
  });

  it('throws the API error message on a non-OK response', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      body: null,
      json: async () => ({ error: 'Query must not be empty', statusCode: 400 }),
    })) as unknown as typeof fetch;

    await expect(collect('  ', fetchImpl)).rejects.toThrow('Query must not be empty');
  });
});
