/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Assistant } from '@/common/types/agent/assistantTypes';

type AssistantNameSource = Pick<Assistant, 'id' | 'name' | 'name_i18n'>;

/** Replace legacy product labels only at the presentation boundary. */
export function normalizeAssistantDisplayName(name: string | undefined | null): string {
  return (name || '')
    .replace(/AionUi\s+CLI/gi, 'OpenH3 CLI')
    .replace(/Aion\s+CLI/gi, 'OpenH3 CLI')
    .replace(/AionUi\s+Butler/gi, 'OpenH3 Butler')
    .replace(/AionUI\s*管家/gi, 'OpenH3 管家')
    .replace(/AionUi\s*管家/gi, 'OpenH3 管家');
}

export function normalizeAssistantForDisplay(assistant: Assistant): Assistant {
  const name_i18n = assistant.name_i18n
    ? Object.fromEntries(
        Object.entries(assistant.name_i18n).map(([locale, name]) => [locale, normalizeAssistantDisplayName(name)])
      )
    : assistant.name_i18n;
  return { ...assistant, name: normalizeAssistantDisplayName(assistant.name), name_i18n };
}

export function resolveAssistantName(
  assistant: AssistantNameSource | null | undefined,
  localeKey: string,
  fallback = 'Assistant'
): string {
  if (!assistant) {
    return fallback;
  }

  const localizedName = assistant.name_i18n?.[localeKey] || assistant.name_i18n?.['en-US'];
  return normalizeAssistantDisplayName(localizedName?.trim() || assistant.name?.trim() || assistant.id || fallback);
}
