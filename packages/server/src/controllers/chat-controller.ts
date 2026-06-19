import type { NextFunction, Request, Response } from 'express';

import { HttpError } from '../middleware/http-error.js';
import { MAX_CHAT_QUERY_LENGTH, type ChatService } from '../services/chat-types.js';
import type { ChatRequest, ChatStreamEvent } from '@bike-route-ai/shared';

export function createChatController(chatService: ChatService) {
  return {
    async stream(req: Request, res: Response, next: NextFunction): Promise<void> {
      const validation = validateChatRequest(req.body);
      if (!validation.ok) {
        next(new HttpError(400, validation.error));
        return;
      }

      // Once the first frame is written, headers are sent and the central error
      // handler can no longer respond — mid-stream errors are surfaced as an SSE
      // `error` event instead. Errors thrown before the first write still flow
      // through `next`.
      let streamStarted = false;
      // `res` 'close' fires once the response finishes normally, but if it fires
      // while we are still writing it means the client aborted — stop pulling
      // tokens so we don't keep paying the LLM for a stream nobody is reading.
      let clientAborted = false;
      res.on('close', () => {
        if (!res.writableFinished) {
          clientAborted = true;
        }
      });

      try {
        for await (const chunk of chatService.streamReply(
          validation.body.query,
          validation.body.conversationId,
        )) {
          if (clientAborted) {
            return;
          }
          if (!streamStarted) {
            startStream(res);
            streamStarted = true;
          }
          writeEvent(res, chunk);
        }

        if (clientAborted) {
          return;
        }
        if (!streamStarted) {
          startStream(res);
        }
        writeEvent(res, { type: 'done' });
        res.end();
      } catch (err) {
        if (!streamStarted) {
          next(err);
          return;
        }
        // Headers already sent: log internally, emit a generic error frame, and
        // close the stream without leaking the underlying message.
        console.error('Chat stream error:', err);
        if (!clientAborted) {
          writeEvent(res, { type: 'error', error: 'Internal Server Error' });
          res.end();
        }
      }
    },
  };
}

function startStream(res: Response): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
}

// Serialize each event as JSON in the SSE `data` field (newline-safe), tagging
// non-token events with a named `event:` line so EventSource-style clients can
// listen for them.
function writeEvent(res: Response, event: ChatStreamEvent): void {
  if (event.type !== 'token') {
    res.write(`event: ${event.type}\n`);
  }
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

type ChatRequestValidation =
  | { ok: true; body: ChatRequest }
  | { ok: false; error: string };

function validateChatRequest(body: unknown): ChatRequestValidation {
  if (!isRecord(body) || typeof body.query !== 'string') {
    return { ok: false, error: 'Request body must include a query string' };
  }

  const query = body.query.trim();
  if (query.length === 0) {
    return { ok: false, error: 'Query must not be empty' };
  }
  if (query.length > MAX_CHAT_QUERY_LENGTH) {
    return { ok: false, error: `Query must be ${MAX_CHAT_QUERY_LENGTH} characters or fewer` };
  }

  // conversationId is optional and opaque; accept a non-empty string, ignore
  // anything else so a malformed id degrades to a standalone turn rather than 400ing.
  const conversationId =
    typeof body.conversationId === 'string' && body.conversationId.length > 0
      ? body.conversationId
      : undefined;

  return { ok: true, body: { query, conversationId } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
