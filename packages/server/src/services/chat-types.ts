export const MAX_CHAT_QUERY_LENGTH = 500;

// Streams the assistant reply for a query as token deltas. Deliberately free of
// express types so the controller owns the HTTP/SSE concerns. An agent / LangChain
// implementation can replace the OpenAI passthrough behind this same interface.
export type ChatService = {
  streamReply(query: string): AsyncIterable<string>;
};
