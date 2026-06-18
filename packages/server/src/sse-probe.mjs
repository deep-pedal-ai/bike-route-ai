import { createApp } from './app.ts';

const app = createApp({
  chatService: {
    async *streamReply() { yield 'Hello'; yield ' '; yield 'world'; },
  },
});

const server = app.listen(0, '127.0.0.1', async () => {
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'hi' }),
  });
  console.log('status', res.status, 'ct', res.headers.get('content-type'));
  const text = await res.text();
  console.log('BODY>>>' + text + '<<<');
  server.close();
});
