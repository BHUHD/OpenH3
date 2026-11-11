/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { type PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcBridge } from '@/common';
import {
  transformMessage,
  type IMessageAcpToolCall,
  type IMessageText,
  type IMessageThinking,
} from '@/common/chat/chatLib';
import {
  MessageListLoadingProvider,
  MessageListProvider,
  MessagePaginationProvider,
  useAddOrUpdateMessage,
  useMessageLstCache,
  useMessageList,
  useReplaceWithAnchorWindow,
} from '@/renderer/pages/conversation/Messages/hooks';

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      userCreated: {
        on: vi.fn().mockReturnValue(() => {}),
      },
      sourceBound: { on: vi.fn().mockReturnValue(() => {}) },
      statusChanged: {
        on: vi.fn().mockReturnValue(() => {}),
      },
      turnCompleted: {
        on: vi.fn().mockReturnValue(() => {}),
      },
    },
    database: {
      getConversationMessages: {
        invoke: vi.fn(),
      },
    },
  },
}));

const CONVERSATION_ID = 'conversation-1';

function createTextMessage(msgId: string, content: string): IMessageText {
  return {
    id: `text-${msgId}-${content}`,
    type: 'text',
    msg_id: msgId,
    conversation_id: CONVERSATION_ID,
    position: 'left',
    content: {
      content,
    },
  };
}

function createThinkingMessage(msgId: string, content: string): IMessageThinking {
  return {
    id: `thinking-${msgId}-${content}`,
    type: 'thinking',
    msg_id: msgId,
    conversation_id: CONVERSATION_ID,
    position: 'left',
    content: {
      content,
      status: 'thinking',
    },
  };
}

function createThinkingDoneMessage(msgId: string, duration: number): IMessageThinking {
  return {
    id: `thinking-done-${msgId}`,
    type: 'thinking',
    msg_id: msgId,
    conversation_id: CONVERSATION_ID,
    position: 'left',
    content: {
      content: '',
      duration,
      status: 'done',
    },
  };
}

function createToolCallMessage(toolCallId: string): IMessageAcpToolCall {
  return {
    id: toolCallId,
    type: 'acp_tool_call',
    msg_id: toolCallId,
    conversation_id: CONVERSATION_ID,
    position: 'left',
    content: {
      session_id: 'session-1',
      update: {
        sessionUpdate: 'tool_call',
        tool_call_id: toolCallId,
        status: 'completed',
        title: 'Read file',
        kind: 'read',
      },
    },
  };
}

function TestWrapper({ children }: PropsWithChildren): JSX.Element {
  return <MessageListProvider value={[]}>{children}</MessageListProvider>;
}

function CacheWrapper({ children }: PropsWithChildren): JSX.Element {
  return (
    <MessageListLoadingProvider value={false}>
      <MessagePaginationProvider
        value={{ hasMoreBefore: false, hasMoreAfter: false, isLoadingBefore: false, isLoadingAnchor: false }}
      >
        <MessageListProvider value={[]}>{children}</MessageListProvider>
      </MessagePaginationProvider>
    </MessageListLoadingProvider>
  );
}

function useMessageHarness() {
  return {
    addOrUpdateMessage: useAddOrUpdateMessage(),
    messages: useMessageList(),
  };
}

function useAnchorMessageHarness() {
  return {
    addOrUpdateMessage: useAddOrUpdateMessage(),
    replaceWithAnchorWindow: useReplaceWithAnchorWindow(),
    messages: useMessageList(),
  };
}

async function flushMessageQueue(): Promise<void> {
  await act(async () => {
    vi.runAllTimers();
  });
}

describe('message merging', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('keeps text segments split when tool calls interrupt the same msg_id stream', async () => {
    const { result } = renderHook(() => useMessageHarness(), {
      wrapper: TestWrapper,
    });

    act(() => {
      result.current.addOrUpdateMessage(createTextMessage('msg-1', 'hello'));
      result.current.addOrUpdateMessage(createTextMessage('msg-1', ' world'));
    });
    await flushMessageQueue();

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].type).toBe('text');
    expect((result.current.messages[0] as IMessageText).content.content).toBe('hello world');

    act(() => {
      result.current.addOrUpdateMessage(createToolCallMessage('tool-1'));
      result.current.addOrUpdateMessage(createTextMessage('msg-1', 'again'));
    });
    await flushMessageQueue();

    expect(result.current.messages.map((message) => message.type)).toEqual(['text', 'acp_tool_call', 'text']);
    expect((result.current.messages[0] as IMessageText).content.content).toBe('hello world');
    expect((result.current.messages[2] as IMessageText).content.content).toBe('again');
  });

  it('keeps thinking segments split when tool calls interrupt the same msg_id stream', async () => {
    const { result } = renderHook(() => useMessageHarness(), {
      wrapper: TestWrapper,
    });

    act(() => {
      result.current.addOrUpdateMessage(createThinkingMessage('msg-1', 'alpha'));
      result.current.addOrUpdateMessage(createThinkingMessage('msg-1', 'beta'));
    });
    await flushMessageQueue();

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].type).toBe('thinking');
    expect((result.current.messages[0] as IMessageThinking).content.content).toBe('alphabeta');

    act(() => {
      result.current.addOrUpdateMessage(createToolCallMessage('tool-1'));
      result.current.addOrUpdateMessage(createThinkingMessage('msg-1', 'gamma'));
    });
    await flushMessageQueue();

    expect(result.current.messages.map((message) => message.type)).toEqual(['thinking', 'acp_tool_call', 'thinking']);
    expect((result.current.messages[0] as IMessageThinking).content.content).toBe('alphabeta');
    expect((result.current.messages[2] as IMessageThinking).content.content).toBe('gamma');
  });

  it('merges thinking done updates into the existing thinking message instead of appending a completion message', async () => {
    const { result } = renderHook(() => useMessageHarness(), {
      wrapper: TestWrapper,
    });

    act(() => {
      result.current.addOrUpdateMessage(createThinkingMessage('msg-1', 'alpha'));
      result.current.addOrUpdateMessage(createToolCallMessage('tool-1'));
      result.current.addOrUpdateMessage(createThinkingDoneMessage('msg-1', 4200));
    });
    await flushMessageQueue();

    expect(result.current.messages.map((message) => message.type)).toEqual(['thinking', 'acp_tool_call']);
    expect((result.current.messages[0] as IMessageThinking).content.status).toBe('done');
    expect((result.current.messages[0] as IMessageThinking).content.duration).toBe(4200);
  });

  it('ignores non-renderable transformed stream messages', async () => {
    const { result } = renderHook(() => useMessageHarness(), {
      wrapper: TestWrapper,
    });

    act(() => {
      result.current.addOrUpdateMessage(undefined);
    });
    await flushMessageQueue();

    expect(result.current.messages).toEqual([]);
  });

  it('keeps live-only and richer streaming messages when replacing with an anchor window', async () => {
    const { result } = renderHook(() => useAnchorMessageHarness(), {
      wrapper: TestWrapper,
    });

    act(() => {
      result.current.addOrUpdateMessage(createTextMessage('agent-1', 'partial streaming response'));
      result.current.addOrUpdateMessage(createTextMessage('agent-2', 'live tail'));
    });
    await flushMessageQueue();

    act(() => {
      result.current.replaceWithAnchorWindow(CONVERSATION_ID, [
        createTextMessage('user-anchor', 'anchor'),
        createTextMessage('agent-1', 'partial'),
      ]);
    });

    expect(result.current.messages.map((message) => message.msg_id)).toEqual(['user-anchor', 'agent-1', 'agent-2']);
    expect((result.current.messages[1] as IMessageText).content.content).toBe('partial streaming response');
    expect((result.current.messages[2] as IMessageText).content.content).toBe('live tail');
  });

  it('requests compact tool content when hydrating historical messages', async () => {
    const invoke = vi.mocked(ipcBridge.database.getConversationMessages.invoke);
    invoke.mockClear();
    invoke.mockResolvedValue({
      items: [],
      oldest_cursor: null,
      newest_cursor: null,
      has_more_before: false,
      has_more_after: false,
    });

    renderHook(() => useMessageLstCache(CONVERSATION_ID), {
      wrapper: CacheWrapper,
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(invoke).toHaveBeenCalledWith({
      conversation_id: CONVERSATION_ID,
      limit: 50,
      content_mode: 'compact',
    });
  });

  it('flips a pending user message to finish when message.statusChanged arrives for it', async () => {
    const invoke = vi.mocked(ipcBridge.database.getConversationMessages.invoke);
    invoke.mockResolvedValue({
      items: [],
      oldest_cursor: null,
      newest_cursor: null,
      has_more_before: false,
      has_more_after: false,
    });

    let emitUserCreated: ((payload: any) => void) | undefined;
    let emitStatusChanged: ((payload: any) => void) | undefined;
    vi.mocked(ipcBridge.conversation.userCreated.on).mockImplementation((cb: any) => {
      emitUserCreated = cb;
      return () => {};
    });
    vi.mocked(ipcBridge.conversation.statusChanged.on).mockImplementation((cb: any) => {
      emitStatusChanged = cb;
      return () => {};
    });

    function useCacheAndListHarness() {
      useMessageLstCache(CONVERSATION_ID);
      return { messages: useMessageList() };
    }

    const { result } = renderHook(() => useCacheAndListHarness(), { wrapper: CacheWrapper });

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      emitUserCreated?.({
        conversation_id: CONVERSATION_ID,
        msg_id: 'msg-midturn-1',
        client_msg_id: 'client-1',
        content: 'sent mid-turn',
        position: 'right',
        status: 'pending',
        hidden: false,
        created_at: Date.now(),
      });
    });

    expect(
      (result.current.messages.find((m) => m.msg_id === 'msg-midturn-1') as IMessageText | undefined)?.status
    ).toBe('pending');

    act(() => {
      emitStatusChanged?.({
        user_id: 'user-1',
        conversation_id: CONVERSATION_ID,
        msg_id: 'msg-midturn-1',
        status: 'finish',
      });
    });

    expect(
      (result.current.messages.find((m) => m.msg_id === 'msg-midturn-1') as IMessageText | undefined)?.status
    ).toBe('finish');
  });

  it('ignores message.statusChanged for a different conversation', async () => {
    const invoke = vi.mocked(ipcBridge.database.getConversationMessages.invoke);
    invoke.mockResolvedValue({
      items: [],
      oldest_cursor: null,
      newest_cursor: null,
      has_more_before: false,
      has_more_after: false,
    });

    let emitUserCreated: ((payload: any) => void) | undefined;
    let emitStatusChanged: ((payload: any) => void) | undefined;
    vi.mocked(ipcBridge.conversation.userCreated.on).mockImplementation((cb: any) => {
      emitUserCreated = cb;
      return () => {};
    });
    vi.mocked(ipcBridge.conversation.statusChanged.on).mockImplementation((cb: any) => {
      emitStatusChanged = cb;
      return () => {};
    });

    function useCacheAndListHarness() {
      useMessageLstCache(CONVERSATION_ID);
      return { messages: useMessageList() };
    }

    const { result } = renderHook(() => useCacheAndListHarness(), { wrapper: CacheWrapper });

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      emitUserCreated?.({
        conversation_id: CONVERSATION_ID,
        msg_id: 'msg-midturn-2',
        content: 'sent mid-turn',
        position: 'right',
        status: 'pending',
        hidden: false,
        created_at: Date.now(),
      });
    });

    act(() => {
      emitStatusChanged?.({
        user_id: 'user-1',
        conversation_id: 'other-conversation',
        msg_id: 'msg-midturn-2',
        status: 'finish',
      });
    });

    expect(
      (result.current.messages.find((m) => m.msg_id === 'msg-midturn-2') as IMessageText | undefined)?.status
    ).toBe('pending');
  });

  it('reconciles a pending badge with the DB row when a turn completes for this conversation', async () => {
    const invoke = vi.mocked(ipcBridge.database.getConversationMessages.invoke);
    invoke.mockResolvedValueOnce({
      items: [],
      oldest_cursor: null,
      newest_cursor: null,
      has_more_before: false,
      has_more_after: false,
    });

    let emitUserCreated: ((payload: any) => void) | undefined;
    let emitTurnCompleted: ((payload: any) => void) | undefined;
    vi.mocked(ipcBridge.conversation.userCreated.on).mockImplementation((cb: any) => {
      emitUserCreated = cb;
      return () => {};
    });
    vi.mocked(ipcBridge.conversation.turnCompleted.on).mockImplementation((cb: any) => {
      emitTurnCompleted = cb;
      return () => {};
    });

    function useCacheAndListHarness() {
      useMessageLstCache(CONVERSATION_ID);
      return { messages: useMessageList() };
    }

    const { result } = renderHook(() => useCacheAndListHarness(), { wrapper: CacheWrapper });

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      emitUserCreated?.({
        conversation_id: CONVERSATION_ID,
        msg_id: 'msg-midturn-3',
        content: 'sent mid-turn',
        position: 'right',
        status: 'pending',
        hidden: false,
        created_at: Date.now(),
      });
    });

    expect(
      (result.current.messages.find((m) => m.msg_id === 'msg-midturn-3') as IMessageText | undefined)?.status
    ).toBe('pending');

    // The reconcile reload returns the DB's authoritative 'finish' row — the
    // missed live statusChanged event never arrived, so this is the only
    // path that heals the badge.
    invoke.mockResolvedValueOnce({
      items: [
        {
          id: 'msg-midturn-3',
          msg_id: 'msg-midturn-3',
          conversation_id: CONVERSATION_ID,
          type: 'text',
          position: 'right',
          status: 'finish',
          hidden: false,
          created_at: Date.now(),
          content: { content: 'sent mid-turn' },
        },
      ],
      oldest_cursor: null,
      newest_cursor: null,
      has_more_before: false,
      has_more_after: false,
    });

    invoke.mockClear();

    act(() => {
      emitTurnCompleted?.({ session_id: CONVERSATION_ID, turn_id: 'turn-1' });
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(invoke).toHaveBeenCalled();
    expect(
      (result.current.messages.find((m) => m.msg_id === 'msg-midturn-3') as IMessageText | undefined)?.status
    ).toBe('finish');
  });

  it('does not reload on turnCompleted when there is no pending right-position message', async () => {
    const invoke = vi.mocked(ipcBridge.database.getConversationMessages.invoke);
    invoke.mockResolvedValue({
      items: [],
      oldest_cursor: null,
      newest_cursor: null,
      has_more_before: false,
      has_more_after: false,
    });

    let emitTurnCompleted: ((payload: any) => void) | undefined;
    vi.mocked(ipcBridge.conversation.turnCompleted.on).mockImplementation((cb: any) => {
      emitTurnCompleted = cb;
      return () => {};
    });

    renderHook(() => useMessageLstCache(CONVERSATION_ID), { wrapper: CacheWrapper });

    await act(async () => {
      await Promise.resolve();
    });

    invoke.mockClear();

    act(() => {
      emitTurnCompleted?.({ session_id: CONVERSATION_ID, turn_id: 'turn-1' });
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(invoke).not.toHaveBeenCalled();
  });

  it('ignores turnCompleted for a different conversation even with a pending row', async () => {
    const invoke = vi.mocked(ipcBridge.database.getConversationMessages.invoke);
    invoke.mockResolvedValue({
      items: [],
      oldest_cursor: null,
      newest_cursor: null,
      has_more_before: false,
      has_more_after: false,
    });

    let emitUserCreated: ((payload: any) => void) | undefined;
    let emitTurnCompleted: ((payload: any) => void) | undefined;
    vi.mocked(ipcBridge.conversation.userCreated.on).mockImplementation((cb: any) => {
      emitUserCreated = cb;
      return () => {};
    });
    vi.mocked(ipcBridge.conversation.turnCompleted.on).mockImplementation((cb: any) => {
      emitTurnCompleted = cb;
      return () => {};
    });

    function useCacheAndListHarness() {
      useMessageLstCache(CONVERSATION_ID);
      return { messages: useMessageList() };
    }

    renderHook(() => useCacheAndListHarness(), { wrapper: CacheWrapper });

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      emitUserCreated?.({
        conversation_id: CONVERSATION_ID,
        msg_id: 'msg-midturn-4',
        content: 'sent mid-turn',
        position: 'right',
        status: 'pending',
        hidden: false,
        created_at: Date.now(),
      });
    });

    invoke.mockClear();

    act(() => {
      emitTurnCompleted?.({ session_id: 'other-conversation', turn_id: 'turn-1' });
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(invoke).not.toHaveBeenCalled();
  });
});

it('applies a server source event to the exact user row and keeps its immutable source', async () => {
  type SourcePayload = Parameters<Parameters<typeof ipcBridge.conversation.sourceBound.on>[0]>[0];
  let emit: ((payload: SourcePayload) => void) | undefined;
  vi.mocked(ipcBridge.conversation.sourceBound.on).mockImplementation((callback) => {
    emit = callback;
    return () => {};
  });
  const source = {
    kind: 'cloud_account',
    issuer: 'https://fixture.invalid',
    subject: 'actor-a',
    provider_id: 'provider-a',
    model: 'actual-model',
    protocol: 'responses',
  } as const;
  vi.mocked(ipcBridge.database.getConversationMessages.invoke).mockResolvedValue({
    items: [
      { ...createTextMessage('source-user', 'hello'), id: 'source-user', position: 'right' },
      { ...createTextMessage('source-user', 'forged raw row'), id: 'raw-duplicate', position: 'right' },
    ],
    oldest_cursor: null,
    newest_cursor: null,
    has_more_before: false,
    has_more_after: false,
  });
  function Harness() {
    useMessageLstCache(CONVERSATION_ID);
    return useMessageList();
  }
  const { result } = renderHook(Harness, { wrapper: CacheWrapper });
  await act(async () => {
    await Promise.resolve();
  });
  act(() =>
    emit?.({ user_id: 'local-owner', conversation_id: 'foreign', msg_id: 'source-user', model_source: source })
  );
  expect(result.current[0].model_source).toBeUndefined();
  act(() =>
    emit?.({ user_id: 'local-owner', conversation_id: CONVERSATION_ID, msg_id: 'source-user', model_source: source })
  );
  expect(result.current[0].model_source).toEqual(source);
  expect(result.current[1].id).toBe('raw-duplicate');
  expect(result.current[1].model_source).toBeUndefined();
  act(() =>
    emit?.({
      user_id: 'local-owner',
      conversation_id: CONVERSATION_ID,
      msg_id: 'source-user',
      model_source: { ...source, subject: 'actor-b' },
    })
  );
  expect(result.current[0].model_source).toEqual(source);
  expect(result.current[1].model_source).toBeUndefined();
});

it('indexes sourced tool updates by server turn identity while preserving raw call IDs', async () => {
  const source = {
    kind: 'cloud_account',
    issuer: 'https://fixture.invalid',
    subject: 'a',
    provider_id: 'p',
    model: 'model',
    protocol: 'responses',
  } as const;
  const frame = (scope: string, status: string): import('@/common/chat/chatLib').IMessageToolCall => ({
    id: `row-${scope}`,
    type: 'tool_call',
    msg_id: `tool:${scope}:call:raw`,
    conversation_id: CONVERSATION_ID,
    model_source: { ...source, subject: scope },
    content: { call_id: 'raw', name: 'Read', status: status as 'running' | 'completed', args: {} },
  });
  const { result } = renderHook(() => ({ add: useAddOrUpdateMessage(), messages: useMessageList() }), {
    wrapper: TestWrapper,
  });
  act(() => result.current.add(frame('a', 'running')));
  act(() => result.current.add(frame('b', 'running')));
  act(() => result.current.add(frame('a', 'completed')));
  await waitFor(() => expect(result.current.messages).toHaveLength(2));
  expect(result.current.messages[0].model_source?.kind).toBe('cloud_account');
  expect(result.current.messages[0].content).toEqual(expect.objectContaining({ status: 'completed', call_id: 'raw' }));
  expect(result.current.messages[1].content).toEqual(expect.objectContaining({ status: 'running', call_id: 'raw' }));
});

it.each(['tool_group', 'acp_tool_call'] as const)(
  'indexes sourced %s updates by server turn identity',
  async (type) => {
    const source = {
      kind: 'cloud_account',
      issuer: 'https://fixture.invalid',
      subject: 'a',
      provider_id: 'p',
      model: 'model',
      protocol: 'responses',
    } as const;
    const frame = (scope: string, finished: boolean) =>
      transformMessage({
        type,
        msg_id: `tool:${scope}:${type}:raw`,
        conversation_id: CONVERSATION_ID,
        model_source: { ...source, subject: scope },
        data:
          type === 'tool_group'
            ? [{ call_id: 'raw', name: 'fixture', status: finished ? 'Success' : 'Executing' }]
            : {
                session_id: 'fixture',
                update: {
                  sessionUpdate: 'tool_call',
                  tool_call_id: 'raw',
                  status: finished ? 'completed' : 'in_progress',
                },
              },
      });
    const { result } = renderHook(() => ({ add: useAddOrUpdateMessage(), messages: useMessageList() }), {
      wrapper: TestWrapper,
    });
    act(() => result.current.add(frame('a', false)));
    act(() => result.current.add(frame('b', false)));
    act(() => result.current.add(frame('a', true)));
    await waitFor(() => expect(result.current.messages).toHaveLength(2));
    const [a, b] = result.current.messages;
    expect(a.model_source).toEqual({ ...source, subject: 'a' });
    expect(b.model_source).toEqual({ ...source, subject: 'b' });
    if (a.type === 'tool_group' && b.type === 'tool_group') {
      expect(a.content[0].status).toBe('Success');
      expect(b.content[0].status).toBe('Executing');
    } else if (a.type === 'acp_tool_call' && b.type === 'acp_tool_call') {
      expect(a.content.update.tool_call_id).toBe('raw');
      expect(a.content.update.status).toBe('completed');
      expect(b.content.update.status).toBe('in_progress');
    } else throw new Error('tool type changed');
  }
);

it('preserves a trusted source when a same-row generic update arrives', async () => {
  const source = {
    kind: 'cloud_account',
    issuer: 'https://fixture.invalid',
    subject: 'original',
    provider_id: 'p',
    model: 'model',
    protocol: 'responses',
  } as const;
  const frame = (subject: string) =>
    transformMessage({
      type: 'tips',
      msg_id: 'same-row',
      conversation_id: CONVERSATION_ID,
      model_source: { ...source, subject },
      data: { content: 'fixture', type: 'info' },
    });
  const { result } = renderHook(() => ({ add: useAddOrUpdateMessage(), messages: useMessageList() }), {
    wrapper: TestWrapper,
  });
  act(() => result.current.add(frame('original')));
  act(() => result.current.add(frame('replacement')));
  await waitFor(() => expect(result.current.messages).toHaveLength(1));
  expect(result.current.messages[0].model_source).toEqual(source);
});

it('keeps a bound user source when an older history page completes after the live event', async () => {
  const source = {
    kind: 'cloud_account',
    issuer: 'https://fixture.invalid',
    subject: 'original',
    provider_id: 'p',
    model: 'model',
    protocol: 'responses',
  } as const;
  const user: IMessageText = {
    ...createTextMessage('source-user', 'hello'),
    id: 'source-user',
    position: 'right',
    model_source: source,
  };
  const assistant: IMessageText = {
    ...createTextMessage('source-agent', 'reply'),
    id: 'client-stream-id',
    model_source: source,
  };
  const { result } = renderHook(
    () => ({ add: useAddOrUpdateMessage(), replace: useReplaceWithAnchorWindow(), messages: useMessageList() }),
    { wrapper: TestWrapper }
  );
  act(() => result.current.add(user));
  act(() => result.current.add(assistant));
  await waitFor(() => expect(result.current.messages).toHaveLength(2));
  act(() =>
    result.current.replace(CONVERSATION_ID, [
      { ...user, model_source: null },
      { ...assistant, id: 'source-agent', model_source: null },
      { ...user, id: 'raw-duplicate', model_source: null },
    ])
  );
  expect(result.current.messages[0].model_source).toEqual(source);
  expect(result.current.messages[1].model_source).toEqual(source);
  expect(result.current.messages[2].model_source).toBeNull();
});
