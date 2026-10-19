/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BrowserWindow } from 'electron';
import { ipcBridge } from '@/common';

export const PROTOCOL_SCHEME = 'openh3';
export const LEGACY_PROTOCOL_SCHEME = 'aionui';
const SUPPORTED_PROTOCOL_SCHEMES = new Set([PROTOCOL_SCHEME, LEGACY_PROTOCOL_SCHEME]);

export const isDeepLinkUrl = (value: string): boolean => {
  try {
    return SUPPORTED_PROTOCOL_SCHEMES.has(new URL(value).protocol.slice(0, -1));
  } catch {
    return false;
  }
};

/**
 * Parse an OpenH3 deep-link URL into action and params.
 * Supports two formats:
 *   1. openh3://add-provider?base_url=xxx&api_key=xxx
 *   2. openh3://provider/add?v=1&data=<base64 JSON>  (one-api / new-api style)
 * The legacy aionui:// scheme is accepted by the same parser for migration.
 */
export const parseDeepLinkUrl = (url: string): { action: string; params: Record<string, string> } | null => {
  try {
    const parsed = new URL(url);
    if (!SUPPORTED_PROTOCOL_SCHEMES.has(parsed.protocol.slice(0, -1))) return null;

    const hostname = parsed.hostname || '';
    const pathname = parsed.pathname.replace(/^\/+/, '');
    const action = pathname ? `${hostname}/${pathname}` : hostname;

    const params: Record<string, string> = {};
    parsed.searchParams.forEach((value, key) => {
      params[key] = value;
    });

    // If data param exists, decode base64 JSON and merge into params
    if (params.data) {
      try {
        const json = JSON.parse(Buffer.from(params.data, 'base64').toString('utf-8'));
        if (json && typeof json === 'object') {
          Object.assign(params, json);
        }
      } catch {
        // Ignore decode errors
      }
      delete params.data;
    }

    return { action, params };
  } catch {
    return null;
  }
};

let mainWindowRef: BrowserWindow | null = null;
let pendingDeepLinkUrl: string | null = process.argv.find(isDeepLinkUrl) || null;

export const setDeepLinkMainWindow = (win: BrowserWindow): void => {
  mainWindowRef = win;
};

export const getPendingDeepLinkUrl = (): string | null => pendingDeepLinkUrl;

export const clearPendingDeepLinkUrl = (): void => {
  pendingDeepLinkUrl = null;
};

/**
 * Send the deep-link payload to the renderer via IPC bridge.
 * If the window isn't ready yet, queue it.
 */
export const handleDeepLinkUrl = (url: string): void => {
  const parsed = parseDeepLinkUrl(url);
  if (!parsed) return;

  if (!mainWindowRef || mainWindowRef.isDestroyed()) {
    pendingDeepLinkUrl = url;
    return;
  }

  ipcBridge.deepLink.received.emit(parsed);
};
