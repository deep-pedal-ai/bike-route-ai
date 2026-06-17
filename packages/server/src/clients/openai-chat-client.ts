import OpenAI from 'openai';

import { DEFAULT_OPENAI_CHAT_MODEL } from '../services/route-search-types.js';
import type { ChatService } from '../services/chat-types.js';

type OpenAIChatServiceOptions = {
  apiKey?: string;
  chatModel?: string;
};

// OpenAI passthrough implementation of ChatService. Streams completion deltas
// straight through with no orchestration — the agent layer slots in later behind
// the same ChatService interface.
export function createOpenAIChatService(options: OpenAIChatServiceOptions = {}): ChatService {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  const chatModel = options.chatModel ?? process.env.OPENAI_CHAT_MODEL ?? DEFAULT_OPENAI_CHAT_MODEL;
  let client: OpenAI | null = null;

  function getClient(): OpenAI {
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is required for chat');
    }
    client ??= new OpenAI({ apiKey });
    return client;
  }

  return {
    async *streamReply(query: string): AsyncIterable<string> {
      const stream = await getClient().chat.completions.create({
        model: chatModel,
        stream: true,
        messages: [{ role: 'user', content: query }],
      });

      for await (const part of stream) {
        const delta = part.choices[0]?.delta?.content;
        if (delta) {
          yield delta;
        }
      }
    },
  };
}
