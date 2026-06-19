import { randomUUID } from 'node:crypto';

import { ChatOpenAI } from '@langchain/openai';
import { MemorySaver } from '@langchain/langgraph';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { isAIMessageChunk, isToolMessage } from '@langchain/core/messages';

import { loadMagicLaneTools } from './magiclane-mcp-client.js';
import { DEFAULT_OPENAI_CHAT_MODEL } from '../services/route-search-types.js';
import type { ChatService, ChatStreamChunk } from '../services/chat-types.js';

type OpenAIChatServiceOptions = {
  apiKey?: string;
  chatModel?: string;
  // Magic Lane MCP connection overrides; fall back to env in the MCP client.
  magiclaneApiKey?: string;
  magiclaneMcpUrl?: string;
};

const SYSTEM_PROMPT = `You are an AI Agent that helps users come up with cycling routes that will fit their
description. If asked what your name is, you are "VeloMind's Planning Agent". When asked what you can do, you will
answer with the following options:
 - help create a route from scratch
 - look up live traffic and weather data

Resolving locations: if the user does not provide coordinates, use the location_search tool to resolve their
place names (starting point, a part of town, a landmark) into coordinates first, then pass those coordinates to the
routing tools. Do not pass a raw place name into a tool's departure/origin field.

Choosing the routing tool:
 - For a plain loop of a target size from one place ("a 20 mile loop from downtown"), use round_trip, then render
   it with render_round_trip_map using the same departure, range, transport, and type.
 - When the user wants the route to PASS THROUGH or STOP somewhere specific ("add a stop in the Arts District",
   "go through Old Town", "a route from A to B"), use route_planner — round_trip cannot honor a stop. Put each stop
   in intermediate_waypoints (use a "coordinates" or "address" stop for a specific place, "reference_poi" for a
   category near an area). To keep it a LOOP with a stop, set destination equal to origin. Then render the result
   with render_routing_map, passing the SAME origin, destination, intermediate_waypoints, transport, and type.
 - When the user asks to UPDATE an existing route (e.g. "now add a stop in X"), reuse the origin/destination and
   distance from the route you already planned earlier in this conversation; do not start over from a blank route.

After rendering, briefly confirm in words what the route does, including the stop(s) you added and roughly where
they are, so the user can tell whether it matched their request.

Convert distances from miles to KM. Default transport is "bike" and type is "shortest" unless the user says
otherwise. If a routing tool returns an error, retry with a slightly different distance; staying within 10 km of
the user's requested distance is fine.
`

// LangGraph ReAct agent implementation of ChatService. The agent binds the
// Magic Lane MCP geospatial tools (when configured) and is wired up with a
// checkpointer for the standard short-term (per-thread) memory scaffolding.
export function createOpenAIChatService(options: OpenAIChatServiceOptions = {}): ChatService {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  const chatModel = options.chatModel ?? process.env.OPENAI_CHAT_MODEL ?? DEFAULT_OPENAI_CHAT_MODEL;
  // Built lazily and memoized: loading MCP tools is async (and may spawn a
  // subprocess), so we do it once on first use rather than per request.
  let agentPromise: Promise<ReturnType<typeof createReactAgent>> | null = null;

  function getAgent(): Promise<ReturnType<typeof createReactAgent>> {
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is required for chat');
    }
    if (!agentPromise) {
      agentPromise = (async () => {
        const tools = await loadMagicLaneTools({
          apiKey: options.magiclaneApiKey,
          url: options.magiclaneMcpUrl,
        });
        const model = new ChatOpenAI({ apiKey, model: chatModel, streaming: true });
        return createReactAgent({
          llm: model,
          tools,
          prompt: SYSTEM_PROMPT,
          checkpointSaver: new MemorySaver(),
        });
      })().catch((err) => {
        // Don't cache a rejected promise — a failed tool load (e.g. transient
        // MCP connection error) should be retryable on the next request.
        agentPromise = null;
        throw err;
      });
    }
    return agentPromise;
  }

  return {
    async *streamReply(query: string, conversationId?: string): AsyncIterable<ChatStreamChunk> {
      // The checkpointer keys per-thread memory on thread_id. Reuse the
      // caller's conversationId so follow-up turns ("now add a stop in X") see
      // the route planned earlier; fall back to a fresh per-call id so an
      // unkeyed request stays an isolated, standalone turn.
      const agent = await getAgent();
      const threadId = conversationId ?? randomUUID();
      const stream = await agent.stream(
        { messages: [{ role: 'user' as const, content: query }] },
        { configurable: { thread_id: threadId }, streamMode: 'messages' },
      );
      for await (const [chunk] of stream) {
        if (isAIMessageChunk(chunk) && typeof chunk.content === 'string' && chunk.content) {
          yield { type: 'token', value: chunk.content };
        } else if (isToolMessage(chunk) && Array.isArray(chunk.content)) {
          // Tool results (e.g. render_round_trip_map) carry non-text content
          // as image_url data-URL blocks — see toToolMessageContent in
          // magiclane-mcp-client.ts. Surface each as its own image chunk.
          for (const block of chunk.content) {
            if (
              typeof block === 'object' &&
              block !== null &&
              'type' in block &&
              block.type === 'image_url' &&
              'image_url' in block &&
              typeof block.image_url === 'object' &&
              block.image_url !== null &&
              'url' in block.image_url &&
              typeof block.image_url.url === 'string'
            ) {
              yield { type: 'image', url: block.image_url.url };
            }
          }
        }
      }
    },
  };
}

