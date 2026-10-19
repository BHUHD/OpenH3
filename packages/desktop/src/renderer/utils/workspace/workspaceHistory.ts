/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

const WORKSPACE_UPDATE_TIME_KEY = 'openh3_workspace_update_time';
const LEGACY_WORKSPACE_UPDATE_TIME_KEY = 'aionui_workspace_update_time';

const readWorkspaceTimes = (): Record<string, number> => {
  const stored =
    localStorage.getItem(WORKSPACE_UPDATE_TIME_KEY) ?? localStorage.getItem(LEGACY_WORKSPACE_UPDATE_TIME_KEY);
  if (!stored) return {};
  return JSON.parse(stored) as Record<string, number>;
};

/**
 * 获取 workspace 的最后更新时间
 */
export const getWorkspaceUpdateTime = (workspace: string): number => {
  try {
    return readWorkspaceTimes()[workspace] || 0;
  } catch {
    // Ignore parsing errors and fall back to default
  }
  return 0;
};

/**
 * 更新 workspace 的最后更新时间
 * 在创建新会话时调用此函数
 */
export const updateWorkspaceTime = (workspace: string): void => {
  try {
    const times = readWorkspaceTimes();
    times[workspace] = Date.now();
    const serialized = JSON.stringify(times);
    localStorage.setItem(WORKSPACE_UPDATE_TIME_KEY, serialized);
    localStorage.setItem(LEGACY_WORKSPACE_UPDATE_TIME_KEY, serialized);
  } catch (error) {
    console.error('[WorkspaceHistory] Failed to update workspace time:', error);
  }
};
