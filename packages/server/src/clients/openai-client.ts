import OpenAI from 'openai';
import {
  DEFAULT_OPENAI_CHAT_MODEL,
  EMBEDDING_MODEL_NAME,
  type RouteSearchAiClient,
  type RouteSearchCandidate,
  type RouteSearchConstraints,
  type RouteSearchRerank,
} from '../services/route-search-types.js';

type ChatMessage = {
  role: 'system' | 'user';
  content: string;
};

type OpenAIRouteSearchClientOptions = {
  apiKey?: string;
  chatModel?: string;
};

const CONSTRAINT_SCHEMA = {
  type: 'object',
  properties: {
    minKm: { type: ['number', 'null'] },
    maxKm: { type: ['number', 'null'] },
    isLoop: { type: ['boolean', 'null'] },
  },
  required: ['minKm', 'maxKm', 'isLoop'],
  additionalProperties: false,
};

const RERANK_SCHEMA = {
  type: 'object',
  properties: {
    rankings: {
      type: 'array',
      minItems: 1,
      maxItems: 3,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          blurb: { type: 'string' },
        },
        required: ['id', 'blurb'],
        additionalProperties: false,
      },
    },
  },
  required: ['rankings'],
  additionalProperties: false,
};

export function createOpenAIRouteSearchClient(
  options: OpenAIRouteSearchClientOptions = {},
): RouteSearchAiClient {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  const chatModel = options.chatModel ?? process.env.OPENAI_CHAT_MODEL ?? DEFAULT_OPENAI_CHAT_MODEL;
  let client: OpenAI | null = null;

  function getClient(): OpenAI {
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is required for route search');
    }
    client ??= new OpenAI({ apiKey });
    return client;
  }

  async function createStructuredJson(
    name: string,
    schema: Record<string, unknown>,
    messages: ChatMessage[],
  ): Promise<unknown> {
    const response = await getClient().chat.completions.create({
      model: chatModel,
      temperature: 0,
      messages,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name,
          strict: true,
          schema,
        },
      },
    });

    const content = response.choices[0]?.message.content;
    if (!content) {
      throw new Error('OpenAI returned an empty structured response');
    }

    return JSON.parse(content) as unknown;
  }

  return {
    async extractConstraints(query: string): Promise<RouteSearchConstraints> {
      const parsed = await createStructuredJson('route_search_constraints', CONSTRAINT_SCHEMA, [
        {
          role: 'system',
          content:
            'Extract only hard route-search constraints from the rider query. Convert miles to kilometers. For around/about/approximately distances, use a 15 percent window. For under/less than, set only maxKm. For at least/over/more than, set only minKm. Set isLoop true for loop/circuit/returns-to-start, false for out-and-back or point-to-point, otherwise null. Do not infer elevation, surface, traffic, or difficulty constraints.',
        },
        { role: 'user', content: query },
      ]);

      return parseConstraints(parsed);
    },

    async embedQuery(query: string): Promise<number[]> {
      const response = await getClient().embeddings.create({
        model: EMBEDDING_MODEL_NAME,
        input: query,
      });
      const embedding = response.data[0]?.embedding;
      if (!embedding || embedding.length === 0) {
        throw new Error('OpenAI returned an empty embedding');
      }
      return embedding;
    },

    async rerank(query: string, candidates: RouteSearchCandidate[]): Promise<RouteSearchRerank[]> {
      const parsed = await createStructuredJson('route_search_rerank', RERANK_SCHEMA, [
        {
          role: 'system',
          content:
            'Choose the best route IDs for the rider query from the provided candidates only. Return up to three IDs in best-first order. Write one concise blurb per route explaining the match. You may write prose only; do not invent numbers or facts beyond the candidate JSON.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            query,
            candidates: candidates.map((candidate) => ({
              id: candidate.id,
              name: candidate.name,
              distanceKm: candidate.distanceKm,
              ascentM: candidate.ascentM,
              isLoop: candidate.isLoop,
              qualityScore: candidate.qualityScore,
              surfaceBreakdown: candidate.surfaceBreakdown,
              description: candidate.description,
            })),
          }),
        },
      ]);

      return parseRankings(parsed);
    },
  };
}

function parseConstraints(value: unknown): RouteSearchConstraints {
  if (!isRecord(value)) {
    throw new Error('OpenAI returned invalid constraints');
  }

  const constraints: RouteSearchConstraints = {};
  const minKm = parseNullableNumber(value.minKm);
  const maxKm = parseNullableNumber(value.maxKm);
  const isLoop = parseNullableBoolean(value.isLoop);

  if (minKm !== null) constraints.minKm = minKm;
  if (maxKm !== null) constraints.maxKm = maxKm;
  if (isLoop !== null) constraints.isLoop = isLoop;

  return constraints;
}

function parseRankings(value: unknown): RouteSearchRerank[] {
  if (!isRecord(value) || !Array.isArray(value.rankings)) {
    throw new Error('OpenAI returned invalid rankings');
  }

  return value.rankings.map((ranking) => {
    if (!isRecord(ranking) || typeof ranking.id !== 'string' || typeof ranking.blurb !== 'string') {
      throw new Error('OpenAI returned invalid ranking item');
    }
    return {
      id: ranking.id,
      blurb: ranking.blurb,
    };
  });
}

function parseNullableNumber(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw new Error('OpenAI returned invalid numeric constraint');
}

function parseNullableBoolean(value: unknown): boolean | null {
  if (value === null) return null;
  if (typeof value === 'boolean') return value;
  throw new Error('OpenAI returned invalid boolean constraint');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
