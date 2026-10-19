/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export const DEFAULT_RECENT_WS_KEY = 'openh3:recent-workspaces';
export const LEGACY_RECENT_WS_KEY = 'aionui:recent-workspaces';
const MAX_RECENT_WORKSPACES = 5;

export const getRecentWorkspaces = (storageKey: string = DEFAULT_RECENT_WS_KEY): string[] => {
  try {
    const legacyKey = storageKey === DEFAULT_RECENT_WS_KEY ? LEGACY_RECENT_WS_KEY : undefined;
    return JSON.parse(localStorage.getItem(storageKey) ?? (legacyKey ? localStorage.getItem(legacyKey) : null) ?? '[]');
  } catch {
    return [];
  }
};

export const addRecentWorkspace = (path: string, storageKey: string = DEFAULT_RECENT_WS_KEY): void => {
  try {
    const prev = getRecentWorkspaces(storageKey);
    const next = [path, ...prev.filter((item) => item !== path)].slice(0, MAX_RECENT_WORKSPACES);
    const serialized = JSON.stringify(next);
    localStorage.setItem(storageKey, serialized);
    if (storageKey === DEFAULT_RECENT_WS_KEY) localStorage.setItem(LEGACY_RECENT_WS_KEY, serialized);
  } catch {}
};
