import type { ChatStreamEvent } from '@bike-route-ai/shared';

export const MAX_CHAT_QUERY_LENGTH = 500;

// A single piece of a streamed reply: a text token delta, or non-text content
// (e.g. a rendered map image) produced by a tool call. Excludes 'done'/'error'
// — those are controller-owned, marking the end of the stream rather than
// content within it.
export type ChatStreamChunk = Exclude<ChatStreamEvent, { type: 'done' } | { type: 'error' }>;

// Streams the assistant reply for a query as token/image chunks. Deliberately
// free of express types so the controller owns the HTTP/SSE concerns. An
// agent / LangChain implementation can replace the OpenAI passthrough behind
// this same interface.
//
// `conversationId` ties successive turns of one chat to the same agent memory
// thread, so follow-ups like "now add a stop in X" build on the route already
// planned. Optional: when absent, the reply is treated as a standalone turn.
export type ChatService = {
  streamReply(query: string, conversationId?: string): AsyncIterable<ChatStreamChunk>;
};
