/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Centralized localStorage keys for the application
 * 应用程序的集中式 localStorage 键管理
 *
 * All localStorage keys should be defined here to:
 * - Avoid key conflicts
 * - Make it easy to find and manage all persisted states
 * - Provide a single source of truth for storage key names
 */
export const STORAGE_KEYS = {
  /** Workspace tree collapse state / 工作空间目录树折叠状态 */
  WORKSPACE_TREE_COLLAPSE: 'openh3_workspace_collapse_state',

  /** Sidebar collapse state / 侧边栏折叠状态 */
  SIDEBAR_COLLAPSE: 'openh3_sider_collapsed',

  /** Theme preference / 主题偏好 */
  THEME: 'openh3_theme',

  /** Language preference / 语言偏好 */
  LANGUAGE: 'openh3_language',
} as const;

/** Keys written by pre-OpenH3 desktop builds. Read once during renderer boot. */
export const LEGACY_STORAGE_KEYS = {
  WORKSPACE_TREE_COLLAPSE: 'aionui_workspace_collapse_state',
  SIDEBAR_COLLAPSE: 'aionui_sider_collapsed',
  THEME: 'aionui_theme',
  LANGUAGE: 'aionui_language',
} as const;

export function migrateLegacyStorageKeys(storage: Storage = localStorage): void {
  for (const key of Object.keys(STORAGE_KEYS) as Array<keyof typeof STORAGE_KEYS>) {
    const canonical = STORAGE_KEYS[key];
    if (storage.getItem(canonical) !== null) continue;
    const legacy = LEGACY_STORAGE_KEYS[key];
    const value = storage.getItem(legacy);
    if (value !== null) storage.setItem(canonical, value);
  }
}

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];
