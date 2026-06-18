import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { usePlanChat } from './use-plan-chat';
import { streamChat } from '../api/chat';

// Mock the API boundary (streamChat) and assert the streaming state machine the
// plan-mode UI depends on.
vi.mock('../api/chat', () => ({
  streamChat: vi.fn(),
}));

const streamChatMock = vi.mocked(streamChat);

async function* tokens(values: string[]): AsyncGenerator<string> {
  for (const value of values) yield value;
}

describe('usePlanChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts idle with no messages, no error, not streaming', () => {
    const { result } = renderHook(() => usePlanChat());

    expect(result.current.messages).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.isStreaming).toBe(false);
  });

  it('records the user turn and accumulates streamed tokens into the assistant turn', async () => {
    streamChatMock.mockReturnValue(tokens(['Plan', ' a', ' ride']));

    const { result } = renderHook(() => usePlanChat());

    await act(async () => {
      await result.current.ask('best gravel loop');
    });

    expect(streamChatMock).toHaveBeenCalledWith('best gravel loop', expect.any(Object));
    expect(result.current.messages).toEqual([
      { role: 'user', content: 'best gravel loop' },
      { role: 'assistant', content: 'Plan a ride' },
    ]);
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('captures the error message and stops streaming on failure', async () => {
    streamChatMock.mockReturnValue(
      (async function* () {
        throw new Error('Internal Server Error');
      })(),
    );

    const { result } = renderHook(() => usePlanChat());

    await act(async () => {
      await result.current.ask('plan something');
    });

    expect(result.current.error).toBe('Internal Server Error');
    expect(result.current.isStreaming).toBe(false);
  });

  it('ignores an empty/whitespace query (no API call)', async () => {
    const { result } = renderHook(() => usePlanChat());

    await act(async () => {
      await result.current.ask('   ');
    });

    expect(streamChatMock).not.toHaveBeenCalled();
  });

  it('reset() clears the messages and error', async () => {
    streamChatMock.mockReturnValue(tokens(['hello']));
    const { result } = renderHook(() => usePlanChat());

    await act(async () => {
      await result.current.ask('hi');
    });
    expect(result.current.messages).toHaveLength(2);

    act(() => result.current.reset());

    expect(result.current.messages).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.isStreaming).toBe(false);
  });
});
