/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { AgentStreamErrorInfo, IMessageText, IMessageTips, TMessage } from '@/common/chat/chatLib';
import {
  composeMessage,
  toolMessageKey,
  mergeAcpToolCallContent,
  mergeTextMessageContent,
  normalizeAgentStreamError,
  normalizeTextMessageContent,
  preferTextMessageVersion,
  sanitizeAcpToolCallContent,
} from '@/common/chat/chatLib';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useAuthContextSafe } from '@/renderer/hooks/context/AuthContext';
import { resolveCurrentUserId } from '@/renderer/hooks/system/currentUserId';
import { createContext } from '@renderer/utils/ui/createContext';
import {
  DEFAULT_MESSAGE_PAGE_LIMIT,
  loadConversationAnchorWindow,
  loadConversationMessagePage,
  loadLatestConversationMessages,
} from '@/renderer/utils/chat/messagePagination';

const [useMessageList, MessageListProvider, useUpdateMessageList] = createContext([] as TMessage[]);
const [useMessageListLoading, MessageListLoadingProvider, useUpdateMessageListLoading] = createContext(false);

const [useChatKey, ChatKeyProvider] = createContext('');

export type MessagePaginationState = {
  oldestCursor?: string;
  newestCursor?: string;
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
  isLoadingBefore: boolean;
  isLoadingAnchor: boolean;
};

const EMPTY_MESSAGE_PAGINATION_STATE: MessagePaginationState = {
  hasMoreBefore: false,
  hasMoreAfter: false,
  isLoadingBefore: false,
  isLoadingAnchor: false,
};

const [useMessagePaginationState, MessagePaginationProvider, useUpdateMessagePaginationState] =
  createContext<MessagePaginationState>(EMPTY_MESSAGE_PAGINATION_STATE);

const beforeUpdateMessageListStack: Array<(list: TMessage[]) => TMessage[]> = [];

// 消息索引缓存类型定义
// Message index cache type definitions
interface MessageIndex {
  msgIdIndex: Map<string, number>; // msg_id -> index
  call_idIndex: Map<string, number>; // tool_call.call_id -> index
  tool_call_idIndex: Map<string, number>; // acp_tool_call.update.tool_call_id -> index
  permission_call_idIndex: Map<string, number>; // permission.content.call_id -> index
  terminal_idIndex: Map<string, number>; // acp_terminal_output.content.terminal_id -> index
}

function getMessageIndexKey(message: TMessage): string | undefined {
  if (!message.msg_id) return undefined;
  // Every frame of a turn shares one msg_id, so any type that needs its own
  // slot in the shared msgIdIndex must namespace its key. Without this, a plan
  // update resolves to whatever frame was appended last and rewrites it.
  if (message.type === 'thinking') return `thinking:${message.msg_id}`;
  if (message.type === 'plan') return `plan:${message.msg_id}`;
  return message.msg_id;
}

// 使用 WeakMap 缓存索引，当列表被 GC 时自动清理
// Use WeakMap to cache index, auto-cleanup when list is GC'd
const indexCache = new WeakMap<TMessage[], MessageIndex>();

export function logDroppedToolCallWithoutCallId(message: TMessage | undefined): boolean {
  if (!message) return false;
  if (message.type !== 'tool_call' || message.content?.call_id) return false;

  console.warn('[tool-call] dropped tool_call without call_id', {
    conversation_id: message.conversation_id,
    msg_id: message.msg_id,
    name: message.content?.name,
    status: message.content?.status,
  });
  return true;
}

// 构建消息索引
// Build message index
export function buildMessageIndex(list: TMessage[]): MessageIndex {
  const msgIdIndex = new Map<string, number>();
  const call_idIndex = new Map<string, number>();
  const tool_call_idIndex = new Map<string, number>();
  const permission_call_idIndex = new Map<string, number>();
  const terminal_idIndex = new Map<string, number>();

  for (let i = 0; i < list.length; i++) {
    const msg = list[i];
    const msgIndexKey = getMessageIndexKey(msg);
    if (msgIndexKey) {
      msgIdIndex.set(msgIndexKey, i);
    }
    if (msg.type === 'tool_call' && msg.content?.call_id) {
      call_idIndex.set(toolMessageKey(msg, msg.content.call_id), i);
    }
    if (msg.type === 'acp_tool_call' && msg.content?.update?.tool_call_id) {
      tool_call_idIndex.set(toolMessageKey(msg, msg.content.update.tool_call_id), i);
    }
    if (msg.type === 'permission' && msg.content?.call_id) {
      permission_call_idIndex.set(msg.content.call_id, i);
    }
    if (msg.type === 'acp_terminal_output' && msg.content?.terminal_id) {
      terminal_idIndex.set(msg.content.terminal_id, i);
    }
  }

  return { msgIdIndex, call_idIndex, tool_call_idIndex, permission_call_idIndex, terminal_idIndex };
}

// 获取或构建索引（带缓存）
// Get or build index with caching
function getOrBuildIndex(list: TMessage[]): MessageIndex {
  let cached = indexCache.get(list);
  if (!cached) {
    cached = buildMessageIndex(list);
    indexCache.set(list, cached);
  }
  return cached;
}

const sanitizeMessageForList = (message: TMessage): TMessage =>
  message.type === 'acp_tool_call'
    ? ({ ...message, content: sanitizeAcpToolCallContent(message.content) } as TMessage)
    : message;

// 使用索引优化的消息合并函数
// Index-optimized message compose function
export function composeMessageWithIndex(
  message: TMessage | undefined,
  list: TMessage[],
  index: MessageIndex
): TMessage[] {
  if (!message) return list || [];

  if (logDroppedToolCallWithoutCallId(message)) {
    return list || [];
  }

  if (!list?.length) {
    const firstMessage = sanitizeMessageForList(message);
    // Update index when adding first message
    const msgIndexKey = getMessageIndexKey(firstMessage);
    if (msgIndexKey) {
      index.msgIdIndex.set(msgIndexKey, 0);
    }
    if (firstMessage.type === 'tool_call' && firstMessage.content.call_id) {
      index.call_idIndex.set(toolMessageKey(firstMessage, firstMessage.content.call_id), 0);
    }
    if (firstMessage.type === 'acp_tool_call' && firstMessage.content.update?.tool_call_id) {
      index.tool_call_idIndex.set(toolMessageKey(firstMessage, firstMessage.content.update.tool_call_id), 0);
    }
    return [firstMessage];
  }

  const last = list[list.length - 1];

  // 对于 tool_group 类型，使用原始的 composeMessage（因为涉及内部数组匹配）
  // For tool_group type, use original composeMessage (involves inner array matching)
  // After composeMessage, the returned list may have different length/ordering,
  // so we must invalidate the index to prevent stale lookups in subsequent calls.
  if (message.type === 'tool_group') {
    const result = composeMessage(message, list);
    if (result !== list) {
      // Rebuild index maps from the new list to keep them in sync
      const rebuilt = buildMessageIndex(result);
      index.msgIdIndex = rebuilt.msgIdIndex;
      index.call_idIndex = rebuilt.call_idIndex;
      index.tool_call_idIndex = rebuilt.tool_call_idIndex;
      index.permission_call_idIndex = rebuilt.permission_call_idIndex;
    }
    return result;
  }

  // A superseding tip replaces its predecessor wherever it already sits in the
  // list instead of appending: codex reports a stalled turn as a series of retry
  // attempts ("Reconnecting... 1/5", then 2/5 …) and the user should watch one
  // card count up rather than collect ten near-identical ones. Matching on the
  // key — not msg_id, which differs per attempt — also survives other messages
  // arriving in between. Tips are rare, so the scan costs nothing.
  if (message.type === 'tips' && message.content?.supersedes_key) {
    const key = message.content.supersedes_key;
    const existingIdx = list.findIndex((item) => item.type === 'tips' && item.content?.supersedes_key === key);
    if (existingIdx >= 0) {
      const newList = list.slice();
      const existing = list[existingIdx];
      newList[existingIdx] = {
        ...existing,
        ...message,
        content: message.content,
        ...(existing.model_source ? { model_source: existing.model_source } : {}),
      } as TMessage;
      return newList;
    }
    const newIdx = list.length;
    const msgIndexKey = getMessageIndexKey(message);
    if (msgIndexKey) index.msgIdIndex.set(msgIndexKey, newIdx);
    return list.concat(message);
  }

  // tool_call: 使用 call_idIndex 快速查找
  // tool_call: use call_idIndex for fast lookup
  if (message.type === 'tool_call' && message.content?.call_id) {
    const existingIdx = index.call_idIndex.get(toolMessageKey(message, message.content.call_id));
    if (existingIdx !== undefined && existingIdx < list.length) {
      const existingMsg = list[existingIdx];
      if (existingMsg.type === 'tool_call') {
        const newList = list.slice();
        const merged = { ...existingMsg.content, ...message.content };
        newList[existingIdx] = { ...existingMsg, content: merged };
        return newList;
      }
    }
    // 未找到，添加新消息并更新索引
    // A TERMINAL frame that finds no card to settle is suspicious: it means the
    // running card is somewhere else (or was never indexed), so the user is left
    // with a spinner that never stops plus a duplicate card. Codex's detached
    // exec makes this reachable — its terminal lands minutes later, under a
    // different turn. Log it so the next occurrence is diagnosable.
    const status = (message.content as { status?: string } | undefined)?.status;
    if (status === 'completed' || status === 'error' || status === 'canceled') {
      console.warn('[tool-call] terminal frame found no card to settle; appending a new one', {
        conversation_id: message.conversation_id,
        msg_id: message.msg_id,
        call_id: message.content.call_id,
        status,
        indexed_call_ids: index.call_idIndex.size,
        list_len: list.length,
      });
    }
    const newIdx = list.length;
    index.call_idIndex.set(toolMessageKey(message, message.content.call_id), newIdx);
    const msgIndexKey = getMessageIndexKey(message);
    if (msgIndexKey) index.msgIdIndex.set(msgIndexKey, newIdx);
    return list.concat(message);
  }

  // acp_terminal_output: one live card per terminal_id, replaced in place
  // (every frame of a turn shares msg_id, so the generic msg_id arm would
  // collapse two terminals of the same turn into one card).
  if (message.type === 'acp_terminal_output' && message.content?.terminal_id) {
    const existingIdx = index.terminal_idIndex.get(message.content.terminal_id);
    if (existingIdx !== undefined && existingIdx < list.length) {
      const existingMsg = list[existingIdx];
      if (existingMsg.type === 'acp_terminal_output') {
        const newList = list.slice();
        newList[existingIdx] = { ...existingMsg, content: message.content };
        return newList;
      }
    }
    const newIdx = list.length;
    index.terminal_idIndex.set(message.content.terminal_id, newIdx);
    return list.concat(message);
  }

  // acp_tool_call: use tool_call_idIndex for fast lookup
  if (message.type === 'acp_tool_call' && message.content?.update?.tool_call_id) {
    const existingIdx = index.tool_call_idIndex.get(toolMessageKey(message, message.content.update.tool_call_id));
    if (existingIdx !== undefined && existingIdx < list.length) {
      const existingMsg = list[existingIdx];
      if (existingMsg.type === 'acp_tool_call') {
        const newList = list.slice();
        const merged = mergeAcpToolCallContent(existingMsg.content, message.content);
        newList[existingIdx] = { ...existingMsg, content: merged };
        return newList;
      }
    }
    // 未找到，添加新消息并更新索引
    const newIdx = list.length;
    index.tool_call_idIndex.set(toolMessageKey(message, message.content.update.tool_call_id), newIdx);
    const msgIndexKey = getMessageIndexKey(message);
    if (msgIndexKey) index.msgIdIndex.set(msgIndexKey, newIdx);
    return list.concat(sanitizeMessageForList(message));
  }

  // permission: use call_id for recovery/live stream dedupe.
  if (message.type === 'permission' && message.content?.call_id) {
    const existingIdx = index.permission_call_idIndex.get(message.content.call_id);
    if (existingIdx !== undefined && existingIdx < list.length) {
      const existingMsg = list[existingIdx];
      if (existingMsg.type === 'permission') {
        const newList = list.slice();
        newList[existingIdx] = {
          ...existingMsg,
          ...message,
          content: message.content,
          ...(existingMsg.model_source ? { model_source: existingMsg.model_source } : {}),
        };
        return newList;
      }
    }
    const newIdx = list.length;
    index.permission_call_idIndex.set(message.content.call_id, newIdx);
    const msgIndexKey = getMessageIndexKey(message);
    if (msgIndexKey) index.msgIdIndex.set(msgIndexKey, newIdx);
    return list.concat(message);
  }

  // text message: merge only with the latest contiguous streaming chunk.
  // text 消息: 只与最后一条连续的流式片段合并，保留被工具/思考打断后的消息边界。
  if (message.type === 'text' && message.msg_id) {
    const existingIdx = index.msgIdIndex.get(message.msg_id);
    if (existingIdx !== undefined && existingIdx < list.length) {
      const existingMsg = list[existingIdx];
      if (existingMsg.type === 'text') {
        // User messages (right position) are complete — skip if already exists to prevent duplicates
        if (message.position === 'right') {
          return list;
        }
        // Complete teammate messages are not streaming chunks — skip if already exists
        if ((message.content as { teammateMessage?: boolean })?.teammateMessage) {
          return list;
        }
      }
    }

    if (last.type === 'text' && last.msg_id === message.msg_id) {
      const newList = list.slice();
      newList[newList.length - 1] = {
        ...last,
        content: mergeTextMessageContent(last.content, message.content),
      };
      return newList;
    }

    const newIdx = list.length;
    index.msgIdIndex.set(message.msg_id, newIdx);
    return list.concat(message);
  }

  // thinking message: merge only with the latest contiguous thinking chunk.
  // Uses "thinking:${msg_id}" key to avoid collision with text messages sharing the same msg_id.
  if (message.type === 'thinking' && message.msg_id) {
    const thinkingKey = `thinking:${message.msg_id}`;
    if (message.content.status === 'done') {
      const existingIdx = index.msgIdIndex.get(thinkingKey);
      if (existingIdx !== undefined && existingIdx < list.length) {
        const existingMsg = list[existingIdx];
        if (existingMsg.type === 'thinking') {
          const newList = list.slice();
          newList[existingIdx] = {
            ...existingMsg,
            content: {
              ...existingMsg.content,
              status: 'done' as const,
              duration: message.content.duration,
              subject: message.content.subject || existingMsg.content.subject,
            },
          };
          return newList;
        }
      }
    }

    if (last.type === 'thinking' && last.msg_id === message.msg_id) {
      const newList = list.slice();
      newList[newList.length - 1] = {
        ...last,
        content: {
          ...last.content,
          content: last.content.content + message.content.content,
          subject: message.content.subject || last.content.subject,
        },
      };
      return newList;
    }

    const newIdx = list.length;
    index.msgIdIndex.set(thinkingKey, newIdx);
    return list.concat(message);
  }

  // plan message: a full-replacement snapshot, updated in place.
  // The key is namespaced (see getMessageIndexKey) because the whole turn shares
  // one msg_id. The type guard is a second line of defence: a stale index entry
  // must never let a plan overwrite a different kind of message.
  if (message.type === 'plan' && message.msg_id) {
    const planKey = `plan:${message.msg_id}`;
    const existingIdx = index.msgIdIndex.get(planKey);
    if (existingIdx !== undefined && existingIdx < list.length) {
      const existingMsg = list[existingIdx];
      if (existingMsg.type === 'plan') {
        const newList = list.slice();
        newList[existingIdx] = { ...existingMsg, content: message.content } as TMessage;
        return newList;
      }
    }
    const newIdx = list.length;
    index.msgIdIndex.set(planKey, newIdx);
    return list.concat(message);
  }

  // agent_status / tips and other msg_id-based messages:
  // replace the existing item in place instead of appending duplicates.
  if (message.msg_id) {
    const existingIdx = index.msgIdIndex.get(message.msg_id);
    if (existingIdx !== undefined && existingIdx < list.length) {
      const existingMsg = list[existingIdx];
      const newList = list.slice();
      newList[existingIdx] = {
        ...existingMsg,
        ...message,
        content: message.content,
        ...(existingMsg.model_source ? { model_source: existingMsg.model_source } : {}),
      } as TMessage;
      return newList;
    }
  }

  // Other types: fallback to last message check
  // 其他类型: 回退到检查最后一条消息
  if (last.msg_id !== message.msg_id || last.type !== message.type) {
    // Add new message and update index
    const newIdx = list.length;
    const msgIndexKey = getMessageIndexKey(message);
    if (msgIndexKey) index.msgIdIndex.set(msgIndexKey, newIdx);
    return list.concat(message);
  }

  // Merge other message types with same msg_id
  const newList = list.slice();
  const lastIdx = newList.length - 1;
  newList[lastIdx] = { ...last, ...message, ...(last.model_source ? { model_source: last.model_source } : {}) };
  return newList;
}

export const useMergeLiveMessage = () => {
  const update = useUpdateMessageList();
  const pendingRef = useRef<Array<{ message: TMessage; add: boolean }>>([]);
  const rafRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    rafRef.current = null;

    const pending = pendingRef.current;
    if (!pending.length) return;
    pendingRef.current = [];
    update((list) => {
      // 获取或构建索引用于快速查找 (O(1) instead of O(n))
      // Get or build index for fast lookup
      const index = getOrBuildIndex(list);
      let newList = list;

      for (const item of pending) {
        if (!item.message) {
          continue;
        }

        if (logDroppedToolCallWithoutCallId(item.message)) {
          continue;
        }

        if (item.add) {
          // 新增消息，更新索引
          // New message, update index
          const msg = sanitizeMessageForList(item.message);
          const newIdx = newList.length;
          const msgIndexKey = getMessageIndexKey(msg);
          if (msgIndexKey) index.msgIdIndex.set(msgIndexKey, newIdx);
          if (msg.type === 'tool_call' && msg.content?.call_id) {
            index.call_idIndex.set(toolMessageKey(msg, msg.content.call_id), newIdx);
          }
          if (msg.type === 'acp_tool_call' && msg.content?.update?.tool_call_id) {
            index.tool_call_idIndex.set(toolMessageKey(msg, msg.content.update.tool_call_id), newIdx);
          }
          if (msg.type === 'permission' && msg.content?.call_id) {
            index.permission_call_idIndex.set(msg.content.call_id, newIdx);
          }
          if (msg.type === 'acp_terminal_output' && msg.content?.terminal_id) {
            index.terminal_idIndex.set(msg.content.terminal_id, newIdx);
          }
          newList = newList.concat(msg);
        } else {
          // 使用索引优化的消息合并
          // Use index-optimized message compose
          newList = composeMessageWithIndex(item.message, newList, index);
        }

        while (beforeUpdateMessageListStack.length) {
          newList = beforeUpdateMessageListStack.shift()!(newList);
        }
      }
      return newList;
    });

    rafRef.current = setTimeout(flush);
  }, []);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        clearTimeout(rafRef.current);
      }
    };
  }, []);

  return useCallback(
    (message: TMessage | undefined, add = false) => {
      if (!message) {
        return;
      }
      pendingRef.current.push({ message, add });
      if (rafRef.current === null) {
        rafRef.current = setTimeout(flush);
      }
    },
    [flush]
  );
};

export const useAddOrUpdateMessage = useMergeLiveMessage;

export const useRemoveMessageByMsgId = () => {
  const update = useUpdateMessageList();

  return useCallback(
    (msgId: string) => {
      update((list) => list.filter((message) => message.msg_id !== msgId));
    },
    [update]
  );
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseJsonRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (isRecord(value)) return value;
  if (typeof value !== 'string') return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const normalizeTipType = (value: unknown, fallback: IMessageTips['content']['type']) =>
  value === 'success' || value === 'warning' || value === 'error' || value === 'info' ? value : fallback;

const normalizePersistedWorkspaceRuntimeError = (
  parsed: Record<string, unknown>,
  message: string
): AgentStreamErrorInfo | undefined => {
  if (
    parsed.code !== 'WORKSPACE_PATH_RUNTIME_UNAVAILABLE' &&
    parsed.code !== 'WORKSPACE_PATH_CONTAINS_WHITESPACE_RUNTIME_UNSUPPORTED'
  ) {
    return undefined;
  }

  const details = isRecord(parsed.details) ? parsed.details : undefined;
  const workspacePath = typeof details?.workspace_path === 'string' ? details.workspace_path : undefined;
  if (!workspacePath) {
    return undefined;
  }

  const persistedError = isRecord(parsed.error) ? parsed.error : undefined;
  const detail = typeof persistedError?.detail === 'string' ? persistedError.detail : message;

  return {
    message,
    code: 'WORKSPACE_PATH_RUNTIME_UNAVAILABLE',
    ownership: 'aionui',
    detail,
    workspacePath,
    retryable: false,
    feedback_recommended: false,
  };
};

const classifyPersistedSendFailure = (
  parsed: Record<string, unknown>,
  message: string
): AgentStreamErrorInfo | undefined => {
  if (typeof parsed.source !== 'string' && typeof parsed.code !== 'string') {
    return undefined;
  }

  const persistedCode = typeof parsed.code === 'string' ? parsed.code : undefined;
  const structuredContent = isRecord(parsed.structuredContent) ? parsed.structuredContent : undefined;
  const domainCode =
    typeof structuredContent?.domainCode === 'string'
      ? structuredContent.domainCode
      : typeof parsed.domainCode === 'string'
        ? parsed.domainCode
        : undefined;
  const effectiveCode = domainCode || persistedCode;

  if (
    effectiveCode === 'MCP_HTTP_RESPONSE_READ_FAILED' ||
    effectiveCode === 'MCP_TOOL_REMOTE_ERROR' ||
    effectiveCode === 'MCP_TOOL_RESPONSE_UNEXPECTED' ||
    effectiveCode === 'MCP_TCP_READ_FAILED' ||
    effectiveCode === 'TEAM_SERVICE_UNAVAILABLE'
  ) {
    return {
      message,
      code: effectiveCode,
      ownership: 'aionui',
      detail: message,
      retryable: true,
      feedback_recommended: true,
    };
  }

  if (
    effectiveCode === 'TEAM_ASSISTANT_ID_REQUIRED' ||
    effectiveCode === 'TEAM_ASSISTANT_NOT_FOUND' ||
    effectiveCode === 'TEAM_ASSISTANT_FIELD_UNSUPPORTED'
  ) {
    return {
      message,
      code: effectiveCode,
      ownership: 'aionui',
      detail: message,
      retryable: false,
      feedback_recommended: false,
    };
  }

  if (persistedCode === 'BAD_GATEWAY') {
    return {
      message,
      code: 'UNKNOWN_UPSTREAM_ERROR',
      ownership: 'unknown_upstream',
      detail: message,
      retryable: true,
      feedback_recommended: true,
    };
  }

  if (persistedCode === 'INTERNAL_ERROR') {
    return {
      message,
      code: 'AIONUI_INTERNAL_ERROR',
      ownership: 'aionui',
      detail: message,
      retryable: true,
      feedback_recommended: true,
    };
  }

  if (persistedCode?.startsWith('AIONUI_')) {
    return { message, code: persistedCode, ownership: 'aionui', detail: message, retryable: true };
  }
  if (persistedCode?.startsWith('USER_AGENT_')) {
    return { message, code: persistedCode, ownership: 'user_agent', detail: message, retryable: true };
  }
  if (persistedCode?.startsWith('USER_LLM_PROVIDER_')) {
    return {
      message,
      code: persistedCode,
      ownership: 'user_llm_provider',
      detail: message,
      retryable: false,
      feedback_recommended: false,
    };
  }
  if (persistedCode === 'UNKNOWN_UPSTREAM_ERROR') {
    return {
      message,
      code: persistedCode,
      ownership: 'unknown_upstream',
      detail: message,
      retryable: true,
      feedback_recommended: true,
    };
  }

  if (parsed.source === 'send_failed') {
    return {
      message,
      code: 'AIONUI_INTERNAL_ERROR',
      ownership: 'aionui',
      detail: message,
      retryable: true,
      feedback_recommended: true,
    };
  }

  return undefined;
};

const normalizeDbTipsMessage = (msg: TMessage): TMessage => {
  if (msg.type !== 'tips') return msg;
  const parsed = parseJsonRecord(msg.content);
  if (!parsed || typeof parsed.content !== 'string') return msg;

  const existingContent = isRecord(msg.content) ? msg.content : undefined;
  const fallbackType =
    existingContent?.type === 'success' ||
    existingContent?.type === 'warning' ||
    existingContent?.type === 'error' ||
    existingContent?.type === 'info'
      ? existingContent.type
      : 'error';
  const tipType = normalizeTipType(parsed.type, fallbackType);
  const code =
    typeof parsed.code === 'string'
      ? parsed.code
      : typeof existingContent?.code === 'string'
        ? existingContent.code
        : undefined;
  const params = isRecord(parsed.params)
    ? parsed.params
    : isRecord(existingContent?.params)
      ? existingContent.params
      : undefined;
  const structuredError =
    tipType === 'error'
      ? (normalizePersistedWorkspaceRuntimeError(parsed, parsed.content) ??
        normalizeAgentStreamError(parsed.error) ??
        classifyPersistedSendFailure(parsed, parsed.content) ??
        normalizeAgentStreamError({ ...parsed, message: parsed.content }))
      : undefined;

  // The merge key has to survive the round trip: it is what tells the history
  // fold below that these rows are one card the user watched count up, not a
  // stack of separate warnings.
  const supersedesKey =
    typeof parsed.supersedes_key === 'string' && parsed.supersedes_key
      ? parsed.supersedes_key
      : typeof existingContent?.supersedes_key === 'string' && existingContent.supersedes_key
        ? existingContent.supersedes_key
        : undefined;

  return {
    ...msg,
    content: {
      content: parsed.content,
      type: tipType,
      ...(tipType !== 'error' && code ? { code } : {}),
      ...(tipType !== 'error' && params ? { params } : {}),
      ...(structuredError ? { error: structuredError } : {}),
      ...(supersedesKey ? { supersedes_key: supersedesKey } : {}),
    },
  } as IMessageTips;
};

/**
 * Collapse superseding tips loaded from history into the single card the user
 * saw live. Every retry attempt is persisted — the backend cannot know which
 * one turns out to be the last — so without this, reopening a conversation
 * re-expands "Reconnecting... 1/5" through "5/5" into a stack, even though the
 * live stream had folded them into one card counting up.
 *
 * The first occurrence keeps its position (so scroll anchors and ordering are
 * stable) and carries the newest attempt's content, which is exactly what the
 * live merge in composeMessageWithIndex produces.
 */
export function foldSupersededTips(messages: TMessage[]): TMessage[] {
  const supersedesKeyOf = (message: TMessage): string | undefined =>
    message.type === 'tips' ? message.content?.supersedes_key : undefined;

  const latestByKey = new Map<string, TMessage>();
  for (const message of messages) {
    const key = supersedesKeyOf(message);
    if (key) latestByKey.set(key, message);
  }
  if (!latestByKey.size) return messages;

  const seen = new Set<string>();
  const folded: TMessage[] = [];
  for (const message of messages) {
    const key = supersedesKeyOf(message);
    if (!key) {
      folded.push(message);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    const latest = latestByKey.get(key);
    folded.push(!latest || latest === message ? message : ({ ...message, content: latest.content } as TMessage));
  }
  return folded.length === messages.length ? messages : folded;
}

/**
 * Normalize a message loaded from backend DB into renderer runtime shape.
 */
export function normalizeDbMessage(msg: TMessage): TMessage {
  if (msg.type === 'tips') return normalizeDbTipsMessage(msg);
  if (msg.type !== 'text') return msg;

  return {
    ...msg,
    content: normalizeTextMessageContent((msg as IMessageText).content),
  };
}

// User rows require exact DB identity. Stream row IDs are minted client-side,
// but their msg_id is the server's persisted row ID. A raw duplicate msg_id
// satisfies neither identity and must not inherit or suppress a live row.
const isSameHistoryRow = (persisted: TMessage, live: TMessage): boolean =>
  persisted.conversation_id === live.conversation_id &&
  persisted.type === live.type &&
  (persisted.id === live.id ||
    (persisted.position !== 'right' &&
      live.position !== 'right' &&
      persisted.id === persisted.msg_id &&
      persisted.msg_id === live.msg_id));

const preferPersistedOrLiveMessage = (persisted: TMessage, live: TMessage): TMessage => {
  if (!isSameHistoryRow(persisted, live)) return persisted;
  const preferred =
    persisted.type === 'text' && live.type === 'text' ? preferTextMessageVersion(persisted, live) : persisted;
  return {
    ...preferred,
    id: persisted.id,
    msg_id: persisted.msg_id,
    model_source: persisted.model_source ?? live.model_source,
  };
};

function mergeLoadedPageWithCurrent(conversationId: string, messages: TMessage[], currentList: TMessage[]): TMessage[] {
  if (!currentList.length) return foldSupersededTips(messages);

  const sameConversation = currentList.filter((message) => message.conversation_id === conversationId);
  if (!sameConversation.length) return foldSupersededTips(messages);

  const currentById = new Map(sameConversation.map((message) => [message.id, message]));

  const mergedMessages = messages.map((message) => {
    const live = currentById.get(message.id) ?? sameConversation.find((current) => isSameHistoryRow(message, current));
    return live ? preferPersistedOrLiveMessage(message, live) : message;
  });
  const liveOnly = sameConversation.filter((live) => !messages.some((persisted) => isSameHistoryRow(persisted, live)));

  // Fold after the concat, not before: the live card and the persisted rows of
  // the same retry run reach this point as separate entries (a persisted tip has
  // no msg_id, so neither merge key matches), and only a key-based fold sees
  // that they are one card.
  return foldSupersededTips(liveOnly.length ? [...mergedMessages, ...liveOnly] : mergedMessages);
}

export function prependHistoryMessages(currentList: TMessage[], messages: TMessage[]): TMessage[] {
  if (!messages.length) return currentList;

  const uniqueHistory = messages.filter(
    (persisted) => !currentList.some((current) => isSameHistoryRow(persisted, current))
  );
  const reconciledCurrent = currentList.map((current) => {
    const persisted =
      messages.find((message) => message.id === current.id && isSameHistoryRow(message, current)) ??
      messages.find((message) => isSameHistoryRow(message, current));
    if (!persisted) return current;
    return {
      ...preferPersistedOrLiveMessage(persisted, current),
      model_source: current.model_source ?? persisted.model_source,
    };
  });
  // Folding the combined list (not the page alone) also covers a retry run whose
  // attempts straddle a page boundary.
  return foldSupersededTips([...uniqueHistory, ...reconciledCurrent]);
}

export const usePrependHistoryPage = () => {
  const update = useUpdateMessageList();
  return useCallback(
    (messages: TMessage[]) => {
      update((list) => prependHistoryMessages(list, messages));
    },
    [update]
  );
};

export const useReplaceWithAnchorWindow = () => {
  const update = useUpdateMessageList();
  return useCallback(
    (conversationId: string, messages: TMessage[]) => {
      update((list) => mergeLoadedPageWithCurrent(conversationId, messages, list));
    },
    [update]
  );
};

export const useLoadPreviousMessagePage = (conversationId?: string) => {
  const pagination = useMessagePaginationState();
  const setPagination = useUpdateMessagePaginationState();
  const prependHistoryPage = usePrependHistoryPage();

  return useCallback(async () => {
    if (!conversationId || !pagination.oldestCursor || !pagination.hasMoreBefore || pagination.isLoadingBefore) {
      return false;
    }

    setPagination((current) => ({ ...current, isLoadingBefore: true }));
    try {
      const page = await loadConversationMessagePage(conversationId, {
        limit: DEFAULT_MESSAGE_PAGE_LIMIT,
        before: pagination.oldestCursor,
        contentMode: 'compact',
      });
      const messages = page.items.map(normalizeDbMessage);
      prependHistoryPage(messages);
      setPagination((current) => ({
        ...current,
        oldestCursor: page.oldest_cursor ?? current.oldestCursor,
        newestCursor: current.newestCursor ?? page.newest_cursor ?? undefined,
        hasMoreBefore: page.has_more_before,
        hasMoreAfter: current.hasMoreAfter || page.has_more_after,
        isLoadingBefore: false,
      }));
      return true;
    } catch (error) {
      console.error('[useLoadPreviousMessagePage] Failed to load previous messages:', error);
      setPagination((current) => ({ ...current, isLoadingBefore: false }));
      return false;
    }
  }, [
    conversationId,
    pagination.hasMoreBefore,
    pagination.isLoadingBefore,
    pagination.oldestCursor,
    prependHistoryPage,
    setPagination,
  ]);
};

export const useLoadAnchorMessageWindow = (conversationId?: string) => {
  const setPagination = useUpdateMessagePaginationState();
  const replaceWithAnchorWindow = useReplaceWithAnchorWindow();

  return useCallback(
    async (messageId: string) => {
      if (!conversationId || !messageId) return false;

      setPagination((current) => ({ ...current, isLoadingAnchor: true }));
      try {
        const page = await loadConversationAnchorWindow(conversationId, messageId, {
          limit: DEFAULT_MESSAGE_PAGE_LIMIT,
          contentMode: 'compact',
        });
        replaceWithAnchorWindow(conversationId, page.items.map(normalizeDbMessage));
        setPagination({
          oldestCursor: page.oldest_cursor ?? undefined,
          newestCursor: page.newest_cursor ?? undefined,
          hasMoreBefore: page.has_more_before,
          hasMoreAfter: page.has_more_after,
          isLoadingBefore: false,
          isLoadingAnchor: false,
        });
        return true;
      } catch (error) {
        console.error('[useLoadAnchorMessageWindow] Failed to load anchor messages:', error);
        setPagination((current) => ({ ...current, isLoadingAnchor: false }));
        return false;
      }
    },
    [conversationId, replaceWithAnchorWindow, setPagination]
  );
};

type SourceBoundPayload = Parameters<Parameters<typeof ipcBridge.conversation.sourceBound.on>[0]>[0];
type MessageSourceScope = {
  conversationId: string;
  ownerId?: string;
  active: boolean;
  acceptsEvents: boolean;
  waitForOwner: boolean;
  pending: Map<string, SourceBoundPayload>;
};

const isSourceBoundRow = (message: TMessage, payload: SourceBoundPayload): boolean =>
  message.conversation_id === payload.conversation_id &&
  message.id === payload.msg_id &&
  message.msg_id === payload.msg_id &&
  message.type === 'text' &&
  message.position === 'right';

const applyPendingModelSources = (list: TMessage[], scope: MessageSourceScope): TMessage[] => {
  if (!scope.active || !scope.ownerId || !scope.pending.size) return list;
  const events = [...scope.pending.values()];
  let changed = false;
  const next = list.map((message) => {
    if (message.model_source) return message;
    const payload = events.find((event) => event.user_id === scope.ownerId && isSourceBoundRow(message, event));
    if (!payload) return message;
    changed = true;
    return { ...message, model_source: payload.model_source };
  });
  return changed ? next : list;
};

export const useMessageLstCache = (key: string) => {
  const update = useUpdateMessageList();
  const list = useMessageList();
  const setLoading = useUpdateMessageListLoading();
  const setPagination = useUpdateMessagePaginationState();
  const auth = useAuthContextSafe();
  const authOwnerId = auth?.user?.id;
  const authStatus = auth?.status;
  const hasAuthContext = auth !== undefined;
  const sourceScope = useMemo<MessageSourceScope>(
    () => ({
      conversationId: key,
      ownerId: authOwnerId,
      active: true,
      acceptsEvents: !hasAuthContext || authStatus === 'authenticated',
      waitForOwner: hasAuthContext && !authOwnerId,
      pending: new Map(),
    }),
    [key, authOwnerId, authStatus, hasAuthContext]
  );

  useEffect(() => {
    sourceScope.active = true;
    if (sourceScope.acceptsEvents && sourceScope.waitForOwner) {
      // Desktop AuthContext deliberately has no user. Resolve the backend's
      // local owner, independently of the mutable cloud account identity.
      void resolveCurrentUserId().then((ownerId) => {
        if (!sourceScope.active) return;
        sourceScope.ownerId = ownerId;
        for (const [id, event] of sourceScope.pending) {
          if (event.user_id !== ownerId) sourceScope.pending.delete(id);
        }
        update((current) => applyPendingModelSources(current, sourceScope));
      });
    }
    return () => {
      sourceScope.active = false;
      sourceScope.pending.clear();
    };
  }, [sourceScope, update]);

  useEffect(() => {
    // Drain only after React committed the exact row, keeping functional
    // updates pure even when React invokes them more than once.
    for (const [id, event] of sourceScope.pending) {
      if (list.some((message) => message.model_source && isSourceBoundRow(message, event))) {
        sourceScope.pending.delete(id);
      }
    }
    if (sourceScope.pending.size) update((current) => applyPendingModelSources(current, sourceScope));
  }, [list, sourceScope, update]);
  // Mirrors the current list into a ref so the turnCompleted handler below
  // can inspect it synchronously without re-subscribing to the WS event on
  // every list change (useState's functional updater runs asynchronously,
  // so update((list) => ...) can't be used for a synchronous read here).
  const listRef = useRef(list);
  useEffect(() => {
    listRef.current = list;
  }, [list]);
  const loadMessages = useCallback(async (): Promise<TMessage[]> => {
    if (!sourceScope.active || !sourceScope.acceptsEvents) return [];
    const result = await loadLatestConversationMessages(key, {
      limit: DEFAULT_MESSAGE_PAGE_LIMIT,
      contentMode: 'compact',
    });
    if (!sourceScope.active) return [];
    const messages = result?.items?.map(normalizeDbMessage);
    if (messages && Array.isArray(messages)) {
      update((currentList) =>
        sourceScope.active
          ? applyPendingModelSources(mergeLoadedPageWithCurrent(key, messages, currentList), sourceScope)
          : currentList
      );
      setPagination({
        oldestCursor: result.oldest_cursor ?? undefined,
        newestCursor: result.newest_cursor ?? undefined,
        hasMoreBefore: result.has_more_before,
        hasMoreAfter: result.has_more_after,
        isLoadingBefore: false,
        isLoadingAnchor: false,
      });
      return messages;
    }
    return [];
  }, [key, setPagination, sourceScope, update]);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    setLoading(true);
    setPagination({ ...EMPTY_MESSAGE_PAGINATION_STATE });
    void loadMessages()
      .catch((error) => {
        console.error('[useMessageLstCache] Failed to load messages from database:', error);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [key, loadMessages, setLoading, setPagination]);

  useEffect(() => {
    if (!key) {
      return;
    }

    return ipcBridge.conversation.userCreated.on((payload) => {
      if (!sourceScope.active || !sourceScope.acceptsEvents || payload.conversation_id !== key) {
        return;
      }

      update((list) => {
        const index = getOrBuildIndex(list);
        return composeMessageWithIndex(
          {
            id: payload.msg_id,
            msg_id: payload.msg_id,
            conversation_id: payload.conversation_id,
            type: 'text',
            position: payload.position,
            status: payload.status,
            hidden: payload.hidden,
            created_at: payload.created_at,
            content: {
              content: payload.content,
            },
          },
          list,
          index
        );
      });
    });
  }, [key, sourceScope, update]);

  useEffect(() => {
    if (!key) return;
    return ipcBridge.conversation.sourceBound.on((payload) => {
      if (!sourceScope.active || !sourceScope.acceptsEvents || payload.conversation_id !== sourceScope.conversationId)
        return;
      if (sourceScope.ownerId && payload.user_id !== sourceScope.ownerId) return;
      // Standalone history surfaces without AuthContext retain the first local
      // event owner for this mount; the application resolves its owner above.
      if (!sourceScope.waitForOwner) sourceScope.ownerId ??= payload.user_id;
      const id = JSON.stringify([payload.user_id, payload.msg_id]);
      if (!sourceScope.pending.has(id)) sourceScope.pending.set(id, payload);
      update((current) => applyPendingModelSources(current, sourceScope));
    });
  }, [key, sourceScope, update]);

  useEffect(() => {
    if (!key) {
      return;
    }

    // Flips a mid-turn-delivered user message's badge from "unread" to
    // consumed once the agent actually picks it up (claude command_lifecycle
    // Started; codex synthetic receipt). Correlates by msg_id — the same
    // server-assigned id message.userCreated used to add the row — never by
    // text/time.
    return ipcBridge.conversation.statusChanged.on((payload) => {
      if (!sourceScope.active || payload.conversation_id !== key) {
        return;
      }

      update((list) =>
        list.map((message) => (message.msg_id === payload.msg_id ? { ...message, status: payload.status } : message))
      );
    });
  }, [key, sourceScope, update]);

  useEffect(() => {
    if (!key) {
      return;
    }

    // Reconciliation backstop at every turn boundary. The live statusChanged
    // flip above is best-effort — a live window can miss the event (codex
    // ack-timeout, a WS gap, or a row left orphaned by a server restart) and
    // then never self-heal because the conversation stays mounted and never
    // reloads. The DB row is the authoritative source of truth, so once a
    // turn for this conversation finishes we re-pull the latest page if (and
    // only if) a right-position text message is still showing 'pending' —
    // loadMessages's merge (preferPersistedOrLiveMessage) lets DB truth win
    // without disturbing anything else in the list.
    return ipcBridge.conversation.turnCompleted.on((payload) => {
      if (!sourceScope.active || payload.session_id !== key) {
        return;
      }

      const hasPendingDelivery = listRef.current.some(
        (message) => message.type === 'text' && message.position === 'right' && message.status === 'pending'
      );

      if (hasPendingDelivery) {
        void loadMessages().catch((error) => {
          console.error('[useMessageLstCache] Failed to reconcile pending messages after turn completion:', error);
        });
      }
    });
  }, [key, loadMessages, sourceScope]);
};

export const beforeUpdateMessageList = (fn: (list: TMessage[]) => TMessage[]) => {
  beforeUpdateMessageListStack.push(fn);
  return () => {
    beforeUpdateMessageListStack.splice(beforeUpdateMessageListStack.indexOf(fn), 1);
  };
};
export {
  ChatKeyProvider,
  MessagePaginationProvider,
  MessageListLoadingProvider,
  MessageListProvider,
  useChatKey,
  useMessagePaginationState,
  useMessageList,
  useMessageListLoading,
  useUpdateMessagePaginationState,
  useUpdateMessageList,
};
