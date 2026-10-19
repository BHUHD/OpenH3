/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * AionUI应用程序共用常量
 */

// ===== 应用内浏览器 / In-app browser =====

/**
 * 所有浏览器 tab 共享的持久化 session partition。
 *
 * 放在 common 而不是渲染进程：渲染进程用它创建 webview，主进程用它清理登录态和
 * 缓存 —— 两边必须是同一个字符串，写死两份迟早对不上。
 *
 * The persistent session partition shared by every in-app browser tab. It lives in
 * common rather than the renderer because the renderer uses it to create webviews
 * while the main process uses it to clear sign-in state and caches; two hardcoded
 * copies would eventually drift apart.
 *
 * 用同一个固定值（而非按 tab / 项目区分）是刻意的：登录态需要在所有 tab、所有项目
 * 之间共享，并在重启后保留 —— 这样用户可以替 Agent 过登录关。
 *
 * A single fixed value (rather than per-tab or per-project) is deliberate: sign-in
 * state must be shared across all tabs and projects and survive restarts, so a
 * user can log in once on the agent's behalf.
 */
// This partition is persisted by Chromium. Keep the historical value as the
// active partition until an explicit cookie/storage migration exists; changing
// it would silently log users out of every embedded browser session.
export const BROWSER_SESSION_PARTITION = 'persist:aionui-browser';

/**
 * 内置浏览器 MCP 的注册名。
 *
 * 放在 common 的理由和上面一样，而且更强：主进程用它注册这个内置 MCP，渲染进程用它
 * 从工具调用流里认出「Agent 正在操作浏览器」并点亮角标。两边必须是同一个字符串，
 * 各写一份早晚会不一致 —— 而不一致的表现是角标永远不亮，很难查。
 *
 * Registered name of the built-in browser MCP.
 *
 * Lives in common for the same reason as the partition above, only more so: the
 * main process registers the built-in MCP under this name, while the renderer uses
 * it to recognise "the agent is driving the browser" in the tool-call stream and
 * light up the activity badge. Both sides must agree exactly; separate copies would
 * eventually drift, and the symptom of drift is a badge that silently never lights.
 */
export const BUILTIN_BROWSER_MCP_NAME = 'openh3-browser';
/** Existing MCP rows are renamed in place during startup migration. */
export const BUILTIN_BROWSER_MCP_LEGACY_NAMES = ['aionui-browser'] as const;

export function isBuiltinBrowserMcpName(name?: string | null): boolean {
  return (
    name === BUILTIN_BROWSER_MCP_NAME ||
    BUILTIN_BROWSER_MCP_LEGACY_NAMES.includes(name as (typeof BUILTIN_BROWSER_MCP_LEGACY_NAMES)[number])
  );
}

// ===== 文件处理相关常量 =====

/** Temporary-file protocol values. The wire values remain unchanged for old files. */
export const OPENH3_TIMESTAMP_SEPARATOR = '_aionui_';
export const OPENH3_TIMESTAMP_REGEX = /_aionui_\d{13}(\.\w+)?$/;
export const OPENH3_FILES_MARKER = '[[AION_FILES]]';

/** @deprecated Use the OpenH3-named aliases above. */
export const AIONUI_TIMESTAMP_SEPARATOR = OPENH3_TIMESTAMP_SEPARATOR;
export const AIONUI_TIMESTAMP_REGEX = OPENH3_TIMESTAMP_REGEX;
export const AIONUI_FILES_MARKER = OPENH3_FILES_MARKER;

// ===== 跨会话消息相关常量 =====
// 必须与后端 crates/openh3-common/src/constants.rs 中的值逐字一致。

/** 发送侧：用户用 `@@` 引用其他会话后，后端追加到消息末尾的块 */
export const OPENH3_SESSIONS_MARKER = '[[AION_SESSIONS]]';
export const OPENH3_SESSIONS_END_MARKER = '[[/AION_SESSIONS]]';

/** 接收侧：跨会话投递时后端加在消息开头的来源块 */
export const OPENH3_SESSION_MESSAGE_MARKER = '[[AION_SESSION_MESSAGE]]';
export const OPENH3_SESSION_MESSAGE_END_MARKER = '[[/AION_SESSION_MESSAGE]]';

/** @deprecated Use the OpenH3-named aliases above. */
export const AIONUI_SESSIONS_MARKER = OPENH3_SESSIONS_MARKER;
export const AIONUI_SESSIONS_END_MARKER = OPENH3_SESSIONS_END_MARKER;
export const AIONUI_SESSION_MESSAGE_MARKER = OPENH3_SESSION_MESSAGE_MARKER;
export const AIONUI_SESSION_MESSAGE_END_MARKER = OPENH3_SESSION_MESSAGE_END_MARKER;

// ===== 媒体类型相关常量 =====

/** 支持的图片文件扩展名 */
export const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.svg'] as const;

/** 文件扩展名到MIME类型的映射 */
export const MIME_TYPE_MAP: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.tiff': 'image/tiff',
  '.svg': 'image/svg+xml',
};

/** MIME类型到文件扩展名的映射 */
export const MIME_TO_EXT_MAP: Record<string, string> = {
  jpeg: '.jpg',
  jpg: '.jpg',
  png: '.png',
  gif: '.gif',
  webp: '.webp',
  bmp: '.bmp',
  tiff: '.tiff',
  'svg+xml': '.svg',
};

/** 默认图片文件扩展名 */
export const DEFAULT_IMAGE_EXTENSION = '.png';

// ===== WebUI 相关常量 =====

/** WebUI default port: 25808 for production, 25809 for development, 25810 for multi-instance dev */
export const WEBUI_DEFAULT_PORT = (() => {
  if (process.env.NODE_ENV === 'production') return 25808;
  if ((process.env.OPENH3_MULTI_INSTANCE ?? process.env.AIONUI_MULTI_INSTANCE) === '1') return 25810;
  return 25809;
})();

export const TEAM_MODE_ENABLED = true;

// ===== AI Provider 相关常量 =====

// Stable ID for the Google Auth virtual provider.
// Shared between frontend (useModelProviderList) and backend (SystemActions).
export const GOOGLE_AUTH_PROVIDER_ID = 'google-auth-gemini';
