/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { resolveBackendAssetUrl } from '@/renderer/utils/platform';
import openh3RoundLogo from '@/renderer/assets/logos/brand/openh3-logo-round.png';

export type AssistantAvatar =
  | { kind: 'image'; value: string }
  | { kind: 'emoji'; value: string }
  | { kind: 'fallback' };

export function isBackendRelativeAssetPath(value: string): boolean {
  return value.startsWith('/api/') || value.startsWith('/assets/');
}

export function isLikelyLocalFilePath(value: string): boolean {
  if (value.startsWith('file://')) return true;
  if (/^[A-Za-z]:[\\/]/.test(value)) return true;
  if (/^\/[A-Za-z]:[\\/]/.test(value)) return true;

  const unixLocalPathPrefixes = ['/Users/', '/home/', '/var/', '/tmp/', '/private/', '/Volumes/', '/mnt/'];
  return unixLocalPathPrefixes.some((prefix) => value.startsWith(prefix));
}

export function resolveAssistantAvatar(avatar: string | undefined): AssistantAvatar {
  const value = avatar?.trim();
  if (!value) return { kind: 'fallback' };

  if (isLikelyLocalFilePath(value)) {
    return { kind: 'fallback' };
  }
  if (value.startsWith('/') && !isBackendRelativeAssetPath(value)) {
    return { kind: 'fallback' };
  }

  // Older backend rows still point at the AionUi brand asset. Keep the data
  // value for compatibility, but render the current circular OpenH3 mark.
  if (/\/logos\/brand\/aion\.svg(?:[?#].*)?$/i.test(value)) {
    return { kind: 'image', value: openh3RoundLogo };
  }

  const resolved = resolveBackendAssetUrl(value) ?? value;
  const isImage = /\.(svg|png|jpe?g|webp|gif)$/i.test(resolved) || /^(https?:|data:|\/)/i.test(resolved);
  if (isImage) {
    return { kind: 'image', value: resolved };
  }

  return { kind: 'emoji', value };
}
