import type { Server } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import { createApp } from '../app.js';
import type { ChatService } from '../services/chat-types.js';

// See routes.test.ts: drive a persistent server bound to a real port and await
// `listening` before issuing requests, rather than passing the app to request()
// directly.
function listen(app: ReturnType<typeof createApp>): Promise<Server> {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function withServer<T>(
  app: ReturnType<typeof createApp>,
  fn: (server: Server) => Promise<T>,
): Promise<T> {
  const server = await listen(app);
  try {
    return await fn(server);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function createFakeChatService(
  streamReply: ChatService['streamReply'] = async function* () {},
): ChatService {
  return { streamReply };
}

// supertest buffers the whole response, so we assert on res.text split into SSE
// frames rather than reading the stream incrementally.
function frames(text: string): string[] {
  return text.split('\n\n').filter((frame) => frame.length > 0);
}

describe('POST /api/chat', () => {
  afterEach(() => {
    // nothing global to reset; servers are closed per withServer call.
  });

  it('streams token frames followed by a done frame', async () => {
    const app = createApp({
      chatService: createFakeChatService(async function* () {
        yield 'Hello';
        yield ' ';
        yield 'world';
      }),
    });

    const res = await withServer(app, (server) =>
      request(server).post('/api/chat').send({ query: 'hi' }),
    );

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(frames(res.text)).toEqual([
      `data: ${JSON.stringify({ type: 'token', value: 'Hello' })}`,
      `data: ${JSON.stringify({ type: 'token', value: ' ' })}`,
      `data: ${JSON.stringify({ type: 'token', value: 'world' })}`,
      `event: done\ndata: ${JSON.stringify({ type: 'done' })}`,
    ]);
  });

  it('returns 400 for a blank query before streaming starts', async () => {
    const app = createApp({ chatService: createFakeChatService() });

    const res = await withServer(app, (server) =>
      request(server).post('/api/chat').send({ query: '   ' }),
    );

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Query must not be empty', statusCode: 400 });
  });

  it('returns 400 when the body has no query string', async () => {
    const app = createApp({ chatService: createFakeChatService() });

    const res = await withServer(app, (server) =>
      request(server).post('/api/chat').send({}),
    );

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Request body must include a query string',
      statusCode: 400,
    });
  });

  it('emits a generic error frame without leaking the message when the stream fails mid-way', async () => {
    const app = createApp({
      chatService: createFakeChatService(async function* () {
        yield 'partial';
        throw new Error('upstream boom');
      }),
    });

    const res = await withServer(app, (server) =>
      request(server).post('/api/chat').send({ query: 'hi' }),
    );

    expect(res.status).toBe(200);
    expect(frames(res.text)).toEqual([
      `data: ${JSON.stringify({ type: 'token', value: 'partial' })}`,
      `event: error\ndata: ${JSON.stringify({ type: 'error', error: 'Internal Server Error' })}`,
    ]);
    expect(res.text).not.toContain('upstream boom');
  });
});
