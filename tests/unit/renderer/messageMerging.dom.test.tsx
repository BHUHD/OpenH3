/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { type PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcBridge } from '@/common';
import { useAuthContextSafe } from '@/renderer/hooks/context/AuthContext';
import { resolveCurrentUserId } from '@/renderer/hooks/system/currentUserId';
import {
  transformMessage,
  type IMessageAcpToolCall,
  type IMessageText,
  type IMessageThinking,
  type TMessage,
} from '@/common/chat/chatLib';
import {
  MessageListLoadingProvider,
  MessageListProvider,
  MessagePaginationProvider,
  useAddOrUpdateMessage,
  useMessageLstCache,
  useMessageList,
  normalizeDbMessage,
  usePrependHistoryPage,
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

vi.mock('@/renderer/hooks/context/AuthContext', () => ({ useAuthContextSafe: vi.fn() }));
vi.mock('@/renderer/hooks/system/currentUserId', () => ({ resolveCurrentUserId: vi.fn() }));

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

function createStreamTextMessage(msgId: string, content: string): IMessageText {
  const message = transformMessage({ type: 'content', conversation_id: CONVERSATION_ID, msg_id: msgId, data: content });
  if (message?.type !== 'text') throw new Error('Expected a transformed text frame');
  return message;
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
      result.current.addOrUpdateMessage(createStreamTextMessage('agent-1', 'partial streaming'));
      result.current.addOrUpdateMessage(createStreamTextMessage('agent-1', ' response'));
      result.current.addOrUpdateMessage(createStreamTextMessage('agent-2', 'live tail'));
    });
    await flushMessageQueue();

    act(() => {
      result.current.replaceWithAnchorWindow(CONVERSATION_ID, [
        createTextMessage('user-anchor', 'anchor'),
        // Persisted text segments use the server message ID as their row ID;
        // only live transformMessage frames have a client-minted row ID.
        { ...createTextMessage('agent-1', 'partial'), id: 'agent-1' },
      ]);
    });

    expect(result.current.messages.map((message) => message.msg_id)).toEqual(['user-anchor', 'agent-1', 'agent-2']);
    expect((result.current.messages[1] as IMessageText).content.content).toBe('partial streaming response');
    expect(result.current.messages[1].id).toBe('agent-1');
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
    ...createStreamTextMessage('source-agent', 'reply'),
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
      normalizeDbMessage({ ...assistant, id: 'source-agent', model_source: null }),
      { ...user, id: 'raw-duplicate', model_source: null },
    ])
  );
  expect(result.current.messages[0].model_source).toEqual(source);
  expect(result.current.messages[1].model_source).toEqual(source);
  expect(result.current.messages[2].model_source).toBeNull();
});

describe('historical source reconciliation lifecycle', () => {
  type SourcePayload = Parameters<Parameters<typeof ipcBridge.conversation.sourceBound.on>[0]>[0];
  type HistoryPage = Awaited<ReturnType<typeof ipcBridge.database.getConversationMessages.invoke>>;
  const source = {
    kind: 'cloud_account',
    issuer: 'https://fixture.invalid',
    subject: 'actor-a',
    provider_id: 'provider-a',
    model: 'actual-model',
    protocol: 'responses',
  } as const;
  const row = (content = 'A longer authentic user prompt'): IMessageText => ({
    ...createTextMessage('user-row', content),
    id: 'user-row',
    position: 'right',
    model_source: null,
  });
  const page = (items: IMessageText[]): HistoryPage => ({
    items,
    oldest_cursor: null,
    newest_cursor: null,
    has_more_before: false,
    has_more_after: false,
  });
  const localAuth = (owner: string | null): NonNullable<ReturnType<typeof useAuthContextSafe>> => ({
    user: owner ? { id: owner, username: owner } : null,
    status: 'authenticated',
    ready: true,
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
    clearAuthCache: vi.fn(),
  });
  const payload = (userId = 'local-owner', conversationId = CONVERSATION_ID): SourcePayload => ({
    user_id: userId,
    conversation_id: conversationId,
    msg_id: 'user-row',
    model_source: source,
  });
  let emit: ((event: SourcePayload) => void) | undefined;
  let unsubscribe: ReturnType<typeof vi.fn>;

  function Harness({ conversationId = CONVERSATION_ID }: { conversationId?: string }) {
    useMessageLstCache(conversationId);
    return {
      messages: useMessageList(),
      add: useAddOrUpdateMessage(),
      replace: useReplaceWithAnchorWindow(),
    };
  }

  beforeEach(() => {
    vi.mocked(useAuthContextSafe).mockReturnValue(localAuth('local-owner'));
    vi.mocked(resolveCurrentUserId).mockResolvedValue('local-owner');
    vi.mocked(ipcBridge.database.getConversationMessages.invoke).mockReset().mockResolvedValue(page([]));
    unsubscribe = vi.fn();
    vi.mocked(ipcBridge.conversation.sourceBound.on).mockImplementation((callback) => {
      emit = callback;
      return unsubscribe;
    });
  });

  afterEach(() => {
    vi.mocked(useAuthContextSafe).mockReturnValue(undefined);
  });

  it.each([
    'raw',
    'A longer authentic user prompt',
    'A much longer raw payload that still has its own persisted identity',
  ])('preserves the exact raw row identity and content when its text is %s', async (rawText) => {
    const { result } = renderHook(Harness, { wrapper: CacheWrapper, initialProps: {} });
    await act(async () => {
      await Promise.resolve();
    });
    act(() => result.current.add(row()));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    const raw = { ...row(rawText), id: 'raw-duplicate' };
    act(() => result.current.replace(CONVERSATION_ID, [row(), raw]));
    expect(result.current.messages[1]).toEqual(raw);
    act(() => emit?.(payload()));
    expect(result.current.messages.map((message) => message.id)).toEqual(['user-row', 'raw-duplicate']);
    expect(result.current.messages[0].model_source).toEqual(source);
    expect(result.current.messages[1]).toEqual(raw);
  });

  it('retains the exact binding before an older initial snapshot installs the user row', async () => {
    let resolvePage: ((value: HistoryPage) => void) | undefined;
    vi.mocked(ipcBridge.database.getConversationMessages.invoke).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePage = resolve;
        })
    );
    const { result } = renderHook(Harness, { wrapper: CacheWrapper, initialProps: {} });
    act(() => {
      emit?.(payload('foreign-owner'));
      emit?.(payload('local-owner', 'foreign-conversation'));
      emit?.(payload());
      emit?.({ ...payload(), model_source: { ...source, subject: 'replacement' } });
    });
    expect(result.current.messages).toEqual([]);
    const raw = { ...row('raw'), id: 'raw-duplicate' };
    await act(async () => resolvePage?.(page([row(), raw])));
    expect(result.current.messages[0].model_source).toEqual(source);
    expect(result.current.messages[1]).toEqual(raw);
  });

  it('does not let a page containing only a raw duplicate suppress the authentic sourced row', async () => {
    const { result } = renderHook(Harness, { wrapper: CacheWrapper, initialProps: {} });
    await act(async () => {
      await Promise.resolve();
    });
    const authentic = { ...row(), model_source: source };
    act(() => result.current.add(authentic));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    const raw = { ...row('raw'), id: 'raw-duplicate' };
    act(() => result.current.replace(CONVERSATION_ID, [raw]));
    expect(result.current.messages).toEqual([raw, authentic]);
  });

  it('applies a retained binding when the exact userCreated row appears later', async () => {
    let emitUserCreated: Parameters<typeof ipcBridge.conversation.userCreated.on>[0] | undefined;
    vi.mocked(ipcBridge.conversation.userCreated.on).mockImplementation((callback) => {
      emitUserCreated = callback;
      return () => {};
    });
    const { result } = renderHook(Harness, { wrapper: CacheWrapper, initialProps: {} });
    await act(async () => {
      await Promise.resolve();
    });
    act(() => emit?.(payload()));
    act(() =>
      emitUserCreated?.({
        conversation_id: CONVERSATION_ID,
        msg_id: 'user-row',
        content: 'hello',
        position: 'right',
        status: 'finish',
        hidden: false,
        created_at: 1,
      })
    );
    expect(result.current.messages[0].model_source).toEqual(source);
  });

  it('fences pending events, callbacks and HTTP responses across a local owner switch', async () => {
    const pages: Array<(value: HistoryPage) => void> = [];
    vi.mocked(ipcBridge.database.getConversationMessages.invoke).mockImplementation(
      () =>
        new Promise((resolve) => {
          pages.push(resolve);
        })
    );
    const { result, rerender } = renderHook(Harness, { wrapper: CacheWrapper, initialProps: {} });
    const oldEmit = emit;
    act(() => emit?.(payload()));
    vi.mocked(useAuthContextSafe).mockReturnValue(localAuth('owner-b'));
    rerender({});
    expect(unsubscribe).toHaveBeenCalled();
    act(() => oldEmit?.(payload()));
    await act(async () => pages[0](page([row()])));
    expect(result.current.messages).toEqual([]);
    await act(async () => pages[1](page([row()])));
    expect(result.current.messages[0].model_source).toBeNull();
    act(() => emit?.(payload()));
    expect(result.current.messages[0].model_source).toBeNull();
    act(() => emit?.({ ...payload('owner-b'), model_source: { ...source, subject: 'actor-b' } }));
    expect(
      result.current.messages[0].model_source?.kind === 'cloud_account' &&
        result.current.messages[0].model_source.subject
    ).toBe('actor-b');
  });

  it('clears pending bindings and fences old responses when the conversation changes', async () => {
    const pages: Array<(value: HistoryPage) => void> = [];
    vi.mocked(ipcBridge.database.getConversationMessages.invoke).mockImplementation(
      () =>
        new Promise((resolve) => {
          pages.push(resolve);
        })
    );
    const { result, rerender } = renderHook(Harness, {
      wrapper: CacheWrapper,
      initialProps: { conversationId: CONVERSATION_ID },
    });
    const oldEmit = emit;
    act(() => emit?.(payload()));
    rerender({ conversationId: 'other-conversation' });
    act(() => oldEmit?.(payload()));
    await act(async () => pages[0](page([row()])));
    expect(result.current.messages).toEqual([]);
    await act(async () => pages[1](page([{ ...row(), conversation_id: 'other-conversation' }])));
    expect(result.current.messages[0].model_source).toBeNull();
    rerender({ conversationId: CONVERSATION_ID });
    await act(async () => pages[2](page([row()])));
    expect(result.current.messages[0].model_source).toBeNull();
  });

  it('releases pending bindings and callbacks on unmount instead of carrying them into a new mount', async () => {
    const first = renderHook(Harness, { wrapper: CacheWrapper, initialProps: {} });
    await act(async () => {
      await Promise.resolve();
    });
    const oldEmit = emit;
    act(() => emit?.(payload()));
    first.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    vi.mocked(ipcBridge.database.getConversationMessages.invoke).mockResolvedValue(page([row()]));
    const second = renderHook(Harness, { wrapper: CacheWrapper, initialProps: {} });
    await act(async () => {
      await Promise.resolve();
    });
    act(() => oldEmit?.(payload()));
    expect(second.result.current.messages[0].model_source).toBeNull();
  });

  it('filters pending desktop events using the resolved local owner while AuthContext has a null user', async () => {
    vi.mocked(useAuthContextSafe).mockReturnValue(localAuth(null));
    let resolveOwner: ((owner: string | undefined) => void) | undefined;
    vi.mocked(resolveCurrentUserId).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveOwner = resolve;
        })
    );
    vi.mocked(ipcBridge.database.getConversationMessages.invoke).mockResolvedValue(page([row()]));
    const { result } = renderHook(Harness, { wrapper: CacheWrapper, initialProps: {} });
    act(() => {
      emit?.(payload('foreign-owner'));
      emit?.(payload());
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.messages[0].model_source).toBeNull();
    await act(async () => resolveOwner?.('local-owner'));
    expect(result.current.messages[0].model_source).toEqual(source);
  });
});

describe('historical source previous-page reconciliation', () => {
  const source = {
    kind: 'cloud_account',
    issuer: 'https://fixture.invalid',
    subject: 'actor-a',
    provider_id: 'provider-a',
    model: 'actual-model',
    protocol: 'responses',
  } as const;
  const userRow = (content = 'authentic A prompt'): IMessageText => ({
    ...createTextMessage('user-row', content),
    id: 'user-row',
    position: 'right',
    model_source: null,
  });
  function renderPreviousPage(initial: TMessage[]) {
    function Wrapper({ children }: PropsWithChildren) {
      return <MessageListProvider value={initial}>{children}</MessageListProvider>;
    }
    return renderHook(() => ({ messages: useMessageList(), prepend: usePrependHistoryPage() }), { wrapper: Wrapper });
  }

  it.each(['prepend', 'anchor'] as const)(
    'keeps distinct normalized persisted left rows intact through %s reconciliation',
    (mode) => {
      const original = normalizeDbMessage({
        ...createTextMessage('assistant-original', 'actual A answer'),
        id: 'assistant-original',
        model_source: source,
      });
      const raw = normalizeDbMessage({
        ...createTextMessage('assistant-original', 'Untrusted distinct raw content longer than the authentic answer'),
        id: 'raw-persisted-duplicate',
        model_source: null,
      });
      function Wrapper({ children }: PropsWithChildren) {
        return <MessageListProvider value={[raw]}>{children}</MessageListProvider>;
      }
      const { result } = renderHook(
        () => ({ messages: useMessageList(), prepend: usePrependHistoryPage(), anchor: useReplaceWithAnchorWindow() }),
        { wrapper: Wrapper }
      );
      act(() => {
        if (mode === 'prepend') result.current.prepend([original]);
        else result.current.anchor(CONVERSATION_ID, [original]);
      });
      expect(result.current.messages).toEqual([original, raw]);
    }
  );

  it('clears ephemeral identity when a copied stream-shaped row is normalized as persisted history', () => {
    const frame = createStreamTextMessage('assistant-original', 'A longer raw persisted duplicate');
    const raw = normalizeDbMessage({ ...frame, id: 'raw-persisted-row', model_source: null });
    const original = normalizeDbMessage({
      ...createTextMessage('assistant-original', 'original'),
      id: 'assistant-original',
      model_source: source,
    });
    const { result } = renderPreviousPage([raw]);
    act(() => result.current.prepend([original]));
    expect(result.current.messages).toEqual([original, raw]);
    expect(Object.getOwnPropertySymbols(raw)).toEqual([]);
    expect(JSON.parse(JSON.stringify(frame))).toEqual(expect.objectContaining({ msg_id: 'assistant-original' }));
  });

  it('keeps a sourced authentic row from a previous page distinct from a current raw duplicate msg_id', () => {
    const raw = { ...userRow('raw'), id: 'raw-duplicate' };
    const authentic = { ...userRow(), model_source: source };
    const { result } = renderPreviousPage([raw]);
    act(() => result.current.prepend([authentic]));
    expect(result.current.messages).toEqual([authentic, raw]);
  });

  it('refreshes the exact overlapping user row with its persisted original source', () => {
    const current = userRow();
    const persisted = { ...current, model_source: source };
    const { result } = renderPreviousPage([current]);
    act(() => result.current.prepend([persisted]));
    expect(result.current.messages).toEqual([persisted]);
  });

  it.each([null, { ...source, subject: 'replacement' }])(
    'preserves the current immutable source and richer live text when an overlapping page source is %j',
    (incomingSource) => {
      const current = { ...userRow('A richer original live user prompt'), model_source: source };
      const { result } = renderPreviousPage([current]);
      act(() => result.current.prepend([{ ...userRow('short'), model_source: incomingSource }]));
      expect(result.current.messages).toEqual([current]);
    }
  );

  it.each(['stream', 'fork'] as const)(
    'preserves the persisted %s row identity and richer left text while reconciling source',
    (kind) => {
      const current: TMessage = {
        ...(kind === 'stream'
          ? createStreamTextMessage('original-segment', 'A richer streaming response')
          : createTextMessage('original-segment', 'A richer streaming response')),
        id: kind === 'stream' ? 'client-stream-row' : 'fork-row',
        model_source: null,
      };
      const persisted = normalizeDbMessage({
        ...current,
        id: kind === 'stream' ? 'original-segment' : 'fork-row',
        content: { content: 'partial' },
        model_source: source,
      });
      const { result } = renderPreviousPage([current]);
      act(() => result.current.prepend([persisted]));
      expect(result.current.messages).toEqual([{ ...persisted, content: current.content }]);
    }
  );

  it('keeps ordinary unsourced previous-page order and richer overlapping text without duplicate rows', () => {
    const older: IMessageText = { ...userRow('older'), id: 'older-row', msg_id: 'older-row' };
    const current = userRow('A richer current unsourced prompt');
    const { result } = renderPreviousPage([current]);
    act(() => result.current.prepend([older, userRow('short')]));
    expect(result.current.messages).toEqual([older, current]);
  });
});
