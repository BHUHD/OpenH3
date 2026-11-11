/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { IResponseMessage } from '@/common/adapter/ipcBridge';
import {
  composeMessage,
  normalizeAgentStreamError,
  normalizeTextMessageContent,
  transformMessage,
  type IMessageText,
  type IMessageTips,
  type IMessageAcpToolCall,
  type IMessageThinking,
  type TMessage,
} from '@/common/chat/chatLib';

const CONVERSATION_ID = 'conversation-1';

function createThinkingMessage(msgId: string, content: string): IMessageThinking {
  return {
    id: `thinking-${content}`,
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

function createTipsMessage(msgId: string, content: string, supersedesKey?: string): IMessageTips {
  return {
    id: supersedesKey ? `tip:${supersedesKey}` : `tip-${msgId}`,
    type: 'tips',
    msg_id: msgId,
    conversation_id: CONVERSATION_ID,
    position: 'center',
    content: {
      content,
      type: 'warning',
      ...(supersedesKey ? { supersedes_key: supersedesKey } : {}),
    },
  };
}

describe('composeMessage', () => {
  it('preserves thinking boundaries once a tool message has been inserted', () => {
    let list: TMessage[] = [];

    list = composeMessage(createThinkingMessage('msg-1', 'alpha'), list);
    list = composeMessage(createThinkingMessage('msg-1', 'beta'), list);

    expect(list).toHaveLength(1);
    expect(list[0].type).toBe('thinking');
    expect((list[0] as IMessageThinking).content.content).toBe('alphabeta');

    list = composeMessage(createToolCallMessage('tool-1'), list);
    list = composeMessage(createThinkingMessage('msg-1', 'gamma'), list);

    expect(list).toHaveLength(3);
    expect(list.map((message) => message.type)).toEqual(['thinking', 'acp_tool_call', 'thinking']);
    expect((list[0] as IMessageThinking).content.content).toBe('alphabeta');
    expect((list[2] as IMessageThinking).content.content).toBe('gamma');
  });

  it('merges thinking done updates back into the latest matching thinking message', () => {
    let list: TMessage[] = [];

    list = composeMessage(createThinkingMessage('msg-1', 'alpha'), list);
    list = composeMessage(createToolCallMessage('tool-1'), list);
    list = composeMessage(createThinkingDoneMessage('msg-1', 3200), list);

    expect(list).toHaveLength(2);
    expect(list.map((message) => message.type)).toEqual(['thinking', 'acp_tool_call']);
    expect((list[0] as IMessageThinking).content.status).toBe('done');
    expect((list[0] as IMessageThinking).content.duration).toBe(3200);
  });

  it('merges a completed ACP diff into its running tool call', () => {
    const running = createToolCallMessage('edit-1');
    running.content.update = {
      ...running.content.update,
      status: 'in_progress',
      title: 'Edit file',
      kind: 'edit',
    };
    const completed: IMessageAcpToolCall = {
      ...running,
      content: {
        ...running.content,
        update: {
          ...running.content.update,
          status: 'completed',
          content: [{ type: 'diff', path: '/workspace/file.ts', old_text: 'old', new_text: 'new' }],
        },
      },
    };

    let list = composeMessage(running, []);
    list = composeMessage(completed, list);

    expect(list).toHaveLength(1);
    expect((list[0] as IMessageAcpToolCall).content.update.status).toBe('completed');
    expect((list[0] as IMessageAcpToolCall).content.update.content).toEqual(completed.content.update.content);
  });

  it('replaces a superseding tip in place instead of appending', () => {
    // codex reports a stalled turn as a series of retry attempts. Appending each
    // one buried the conversation under near-identical cards; the user should
    // watch a single card count up.
    const retry = (attempt: number) =>
      createTipsMessage(`tip-${attempt}`, `Reconnecting... ${attempt}/5 — high demand`, 'codex-retry:turn-1');

    let list = composeMessage(retry(1), []);
    // Something else arriving in between must not break the match: the branch
    // keys on supersedes_key, not on the tip being the tail of the list.
    list = composeMessage(createToolCallMessage('tool-1'), list);
    list = composeMessage(retry(2), list);
    list = composeMessage(retry(3), list);

    const tips = list.filter((message) => message.type === 'tips');
    expect(tips).toHaveLength(1);
    expect((tips[0] as IMessageTips).content.content).toContain('3/5');
    expect(list.map((message) => message.type)).toEqual(['tips', 'acp_tool_call']);
  });

  it('keeps a retry card scoped to its own turn', () => {
    let list = composeMessage(createTipsMessage('tip-1', 'Reconnecting... 1/5', 'codex-retry:turn-1'), []);
    list = composeMessage(createTipsMessage('tip-2', 'Reconnecting... 1/5', 'codex-retry:turn-2'), list);

    expect(list.filter((message) => message.type === 'tips')).toHaveLength(2);
  });

  it('still appends tips that carry no superseding key', () => {
    let list = composeMessage(createTipsMessage('tip-1', 'first'), []);
    list = composeMessage(createTipsMessage('tip-2', 'second'), list);

    expect(list.filter((message) => message.type === 'tips')).toHaveLength(2);
  });
});

describe('normalizeAgentStreamError', () => {
  it('treats resolution-only error metadata as structured', () => {
    expect(
      normalizeAgentStreamError({
        message: 'Agent is still responding',
        resolution: {
          kind: 'wait_for_current_response',
        },
      })
    ).toEqual({
      message: 'Agent is still responding',
      resolution: {
        kind: 'wait_for_current_response',
      },
    });
  });

  it('drops unknown resolution kind and target values', () => {
    expect(
      normalizeAgentStreamError({
        message: 'Provider authentication failed',
        resolution: {
          kind: 'check_provider_credentials',
          target: 'unexpected_settings',
        },
      })
    ).toEqual({
      message: 'Provider authentication failed',
      resolution: {
        kind: 'check_provider_credentials',
      },
    });

    expect(
      normalizeAgentStreamError({
        message: 'Unknown recovery action',
        resolution: {
          kind: 'open_secret_panel',
          target: 'provider_settings',
        },
      })
    ).toBeUndefined();
  });

  it('preserves workspace path metadata on structured errors', () => {
    expect(
      normalizeAgentStreamError({
        message: 'The current Agent failed to run in this workspace path.',
        code: 'WORKSPACE_PATH_RUNTIME_UNAVAILABLE',
        workspacePath: '/tmp/Archive ',
      })
    ).toEqual({
      message: 'The current Agent failed to run in this workspace path.',
      code: 'WORKSPACE_PATH_RUNTIME_UNAVAILABLE',
      workspacePath: '/tmp/Archive ',
    });
  });

  it('preserves the rawError diagnostic summary on internal errors', () => {
    expect(
      normalizeAgentStreamError({
        message: 'Something went wrong, please try again.',
        code: 'AIONUI_INTERNAL_ERROR',
        rawError: {
          name: 'Error',
          message: 'connect ECONNREFUSED',
          code: 'ECONNREFUSED',
          status: 500,
          stack: 'Error: connect ECONNREFUSED\n    at frame',
        },
      })
    ).toEqual({
      message: 'Something went wrong, please try again.',
      code: 'AIONUI_INTERNAL_ERROR',
      rawError: {
        name: 'Error',
        message: 'connect ECONNREFUSED',
        code: 'ECONNREFUSED',
        status: 500,
        stack: 'Error: connect ECONNREFUSED\n    at frame',
      },
    });
  });

  it('drops malformed rawError fields and keeps only valid ones', () => {
    expect(
      normalizeAgentStreamError({
        message: 'Something went wrong, please try again.',
        code: 'AIONUI_INTERNAL_ERROR',
        rawError: {
          name: 'Error',
          message: 42,
          status: 'not-a-number',
          extra: 'ignored',
        },
      })
    ).toEqual({
      message: 'Something went wrong, please try again.',
      code: 'AIONUI_INTERNAL_ERROR',
      rawError: {
        name: 'Error',
      },
    });
  });

  it('omits rawError when it has no usable fields', () => {
    expect(
      normalizeAgentStreamError({
        message: 'Something went wrong, please try again.',
        code: 'AIONUI_INTERNAL_ERROR',
        rawError: { unrelated: true },
      })
    ).toEqual({
      message: 'Something went wrong, please try again.',
      code: 'AIONUI_INTERNAL_ERROR',
    });
  });
});

describe('normalizeTextMessageContent', () => {
  it('normalizes snake_case team metadata from an object payload', () => {
    expect(
      normalizeTextMessageContent({
        content: '已向 Lead Agent 报告就绪状态',
        teammate_message: true,
        sender_name: 'Codex Assistant',
        sender_backend: 'codex',
        sender_conversation_id: 'teammate-conversation-1',
      })
    ).toEqual({
      content: '已向 Lead Agent 报告就绪状态',
      teammateMessage: true,
      senderName: 'Codex Assistant',
      senderAgentType: 'codex',
      senderConversationId: 'teammate-conversation-1',
    });
  });

  it('preserves camelCase team metadata from an already-normalized object payload', () => {
    expect(
      normalizeTextMessageContent({
        content: 'online and ready',
        teammateMessage: true,
        senderName: 'Claude Assistant',
        senderAgentType: 'claude',
        senderConversationId: 'teammate-conversation-2',
        replace: true,
      })
    ).toEqual({
      content: 'online and ready',
      teammateMessage: true,
      senderName: 'Claude Assistant',
      senderAgentType: 'claude',
      senderConversationId: 'teammate-conversation-2',
      replace: true,
    });
  });

  it('normalizes JSON string text content from persisted DB payloads', () => {
    expect(
      normalizeTextMessageContent(
        JSON.stringify({
          content: '[Codex Assistant] idle',
          teammate_message: true,
          sender_name: 'Codex Assistant',
          sender_backend: 'codex',
          sender_conversation_id: 'teammate-conversation-3',
        })
      )
    ).toEqual({
      content: '[Codex Assistant] idle',
      teammateMessage: true,
      senderName: 'Codex Assistant',
      senderAgentType: 'codex',
      senderConversationId: 'teammate-conversation-3',
    });
  });

  it('keeps ordinary string text messages as plain content', () => {
    expect(normalizeTextMessageContent('hello')).toEqual({
      content: 'hello',
    });
  });

  it('lets stream-level replace override a plain text payload', () => {
    expect(normalizeTextMessageContent('replacement text', { replace: true })).toEqual({
      content: 'replacement text',
      replace: true,
    });
  });
});

describe('transformMessage', () => {
  it('returns undefined for hidden system stream messages', () => {
    const message: IResponseMessage = {
      type: 'system',
      data: 'cron metadata',
      msg_id: 'system-1',
      conversation_id: CONVERSATION_ID,
      hidden: true,
    };

    expect(transformMessage(message)).toBeUndefined();
  });

  it('uses explicit stream position for team projected user text messages', () => {
    const message: IResponseMessage = {
      type: 'text',
      data: {
        content: '你好',
      },
      msg_id: 'team-user-message-1',
      conversation_id: CONVERSATION_ID,
      position: 'right',
      status: 'finish',
      replace: true,
    };

    const transformed = transformMessage(message) as IMessageText;

    expect(transformed.type).toBe('text');
    expect(transformed.position).toBe('right');
    expect(transformed.status).toBe('finish');
    expect(transformed.content).toEqual({
      content: '你好',
      replace: true,
    });
  });

  it('normalizes team teammate metadata on realtime text messages', () => {
    const message: IResponseMessage = {
      type: 'text',
      data: {
        content: '[Codex Assistant] idle',
        teammate_message: true,
        sender_name: 'Codex Assistant',
        sender_backend: 'codex',
        sender_conversation_id: 'teammate-conversation-1',
      },
      msg_id: 'team-teammate-message-1',
      conversation_id: CONVERSATION_ID,
      position: 'left',
      status: 'finish',
    };

    const transformed = transformMessage(message) as IMessageText;

    expect(transformed.type).toBe('text');
    expect(transformed.position).toBe('left');
    expect(transformed.status).toBe('finish');
    expect(transformed.content).toEqual({
      content: '[Codex Assistant] idle',
      teammateMessage: true,
      senderName: 'Codex Assistant',
      senderAgentType: 'codex',
      senderConversationId: 'teammate-conversation-1',
    });
  });

  it('keeps plain text stream messages left when no explicit position is present', () => {
    const message: IResponseMessage = {
      type: 'text',
      data: {
        content: 'agent response',
      },
      msg_id: 'agent-message-1',
      conversation_id: CONVERSATION_ID,
    };

    const transformed = transformMessage(message) as IMessageText;

    expect(transformed.type).toBe('text');
    expect(transformed.position).toBe('left');
    expect(transformed.content.content).toBe('agent response');
  });

  it('preserves structured agent stream error metadata', () => {
    const message: IResponseMessage = {
      type: 'error',
      data: {
        message: 'The model provider rejected the request',
        code: 'USER_LLM_PROVIDER_AUTH_FAILED',
        ownership: 'user_llm_provider',
        detail: 'Provider returned 401.',
        workspacePath: '/tmp/provider-test',
        retryable: false,
        feedback_recommended: false,
        resolution: {
          kind: 'check_provider_credentials',
          target: 'provider_settings',
        },
      },
      msg_id: 'error-1',
      conversation_id: CONVERSATION_ID,
    };

    const transformed = transformMessage(message) as IMessageTips;

    expect(transformed.type).toBe('tips');
    expect(transformed.content.content).toBe('The model provider rejected the request');
    expect(transformed.content.error).toEqual({
      message: 'The model provider rejected the request',
      code: 'USER_LLM_PROVIDER_AUTH_FAILED',
      ownership: 'user_llm_provider',
      detail: 'Provider returned 401.',
      workspacePath: '/tmp/provider-test',
      retryable: false,
      feedback_recommended: false,
      resolution: {
        kind: 'check_provider_credentials',
        target: 'provider_settings',
      },
    });
  });

  it('preserves structured metadata on live tips error messages', () => {
    const message: IResponseMessage = {
      type: 'tips',
      data: {
        content: 'AionUI failed while sending the message',
        type: 'error',
        source: 'send_failed',
        code: 'INTERNAL_ERROR',
        error: {
          message: 'AionUI failed while sending the message',
          code: 'AIONUI_INTERNAL_ERROR',
          ownership: 'aionui',
          detail: 'Failed to write Codex sandbox config',
          retryable: true,
          feedback_recommended: true,
          resolution: {
            kind: 'send_feedback',
            target: 'feedback',
          },
        },
      },
      msg_id: 'tips-error-1',
      conversation_id: CONVERSATION_ID,
    };

    const transformed = transformMessage(message) as IMessageTips;

    expect(transformed.type).toBe('tips');
    expect(transformed.content.error).toEqual({
      message: 'AionUI failed while sending the message',
      code: 'AIONUI_INTERNAL_ERROR',
      ownership: 'aionui',
      detail: 'Failed to write Codex sandbox config',
      retryable: true,
      feedback_recommended: true,
      resolution: {
        kind: 'send_feedback',
        target: 'feedback',
      },
    });
  });

  it('preserves info tip type with code and params', () => {
    const message: IResponseMessage = {
      type: 'tips',
      data: {
        content: 'Select a slash command to continue',
        type: 'info',
        code: 'acp.empty_turn.choose_command',
        params: {
          command_count: 3,
        },
      },
      msg_id: 'tips-info-1',
      conversation_id: CONVERSATION_ID,
    };

    const transformed = transformMessage(message) as IMessageTips;

    expect(transformed.type).toBe('tips');
    expect(transformed.content).toMatchObject({
      content: 'Select a slash command to continue',
      type: 'info',
      code: 'acp.empty_turn.choose_command',
      params: {
        command_count: 3,
      },
    });
  });
});

describe('historical model source contract', () => {
  const source = {
    kind: 'cloud_account',
    issuer: 'https://fixture.invalid',
    subject: 'actor-a',
    provider_id: 'provider-a',
    model: 'same-model-id',
    protocol: 'responses',
  } as const;
  it('preserves server source through live text and tool updates', () => {
    const first = transformMessage({
      type: 'content',
      data: 'one',
      msg_id: 'source-text',
      conversation_id: CONVERSATION_ID,
      model_source: source,
    });
    const second = transformMessage({
      type: 'content',
      data: 'two',
      msg_id: 'source-text',
      conversation_id: CONVERSATION_ID,
      model_source: { ...source, subject: 'later-account' },
    });
    const merged = composeMessage(second, composeMessage(first, []));
    expect(merged[0].model_source).toEqual(source);
    expect(merged[0].content).toEqual(expect.objectContaining({ content: 'onetwo' }));
    const tool = transformMessage({
      type: 'tool_call',
      data: { call_id: 'tool', name: 'Read', status: 'running', args: {} },
      msg_id: 'tool',
      conversation_id: CONVERSATION_ID,
      model_source: source,
    });
    expect(tool?.model_source).toEqual(source);
  });
  it('never promotes untrusted payload source or current selection to historical source', () => {
    const message = transformMessage({
      type: 'content',
      data: { content: 'legacy', model_source: source },
      msg_id: 'legacy',
      conversation_id: CONVERSATION_ID,
    });
    expect(message?.model_source).toBeUndefined();
    const unavailable = transformMessage({
      type: 'content',
      data: 'unsent',
      msg_id: 'unsent',
      conversation_id: CONVERSATION_ID,
      model_source: null,
    });
    expect(unavailable?.model_source).toBeNull();
  });
});

it('keeps sourced tool identities separate across turns and merges a late A update into A', () => {
  const sourceA = {
    kind: 'cloud_account',
    issuer: 'https://fixture.invalid',
    subject: 'a',
    provider_id: 'p-a',
    model: 'model',
    protocol: 'responses',
  } as const;
  const sourceB = { ...sourceA, subject: 'b', provider_id: 'p-b' };
  const frame = (scope: string, model_source: typeof sourceA | typeof sourceB, status: string) =>
    transformMessage({
      type: 'tool_call',
      data: { call_id: 'same-raw-id', name: 'Read', status, args: {} },
      msg_id: `tool:${scope}:call:same-raw-id`,
      conversation_id: CONVERSATION_ID,
      model_source,
    });
  const first = composeMessage(frame('a', sourceA, 'running'), []);
  const both = composeMessage(frame('b', sourceB, 'running'), first);
  const settled = composeMessage(frame('a', sourceA, 'completed'), both);
  expect(settled).toHaveLength(2);
  expect(settled[0].model_source).toEqual(sourceA);
  expect(settled[0].content).toEqual(expect.objectContaining({ status: 'completed', call_id: 'same-raw-id' }));
  expect(settled[1].model_source).toEqual(sourceB);
  expect(settled[1].content).toEqual(expect.objectContaining({ status: 'running' }));
});

it.each(['tool_group', 'acp_tool_call'] as const)('keeps sourced %s live updates in their original turn', (type) => {
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
  const both = composeMessage(frame('b', false), composeMessage(frame('a', false), []));
  const settled = composeMessage(frame('a', true), both);
  expect(settled).toHaveLength(2);
  expect(
    settled.map((message) => message.model_source?.kind === 'cloud_account' && message.model_source.subject)
  ).toEqual(['a', 'b']);
  if (settled[0].type === 'tool_group' && settled[1].type === 'tool_group') {
    expect(settled[0].content).toEqual([{ call_id: 'raw', name: 'fixture', status: 'Success' }]);
    expect(settled[1].content[0].status).toBe('Executing');
  } else if (settled[0].type === 'acp_tool_call' && settled[1].type === 'acp_tool_call') {
    expect(settled[0].content.update.tool_call_id).toBe('raw');
    expect(settled[0].content.update.status).toBe('completed');
    expect(settled[1].content.update.status).toBe('in_progress');
  } else throw new Error('tool type changed');
});
