/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SlashCommandItem } from './types';

/**
 * Keep the persisted conversation snapshot while surfacing user skills that
 * were imported after the conversation was created.
 */
export function mergeLoadedSkillNames(
  loadedSkills: readonly string[] | undefined,
  additionalSkills: readonly string[] = []
): string[] {
  return [...new Set([...(loadedSkills ?? []), ...additionalSkills])];
}

/**
 * Builds slash command items for the skills loaded into the current
 * conversation. Skills are inserted as `/name ` templates (never executed
 * immediately) so the user can add arguments before sending.
 *
 * @param loadedSkills - Skill names mounted on the conversation (snapshot).
 * @param descriptionByName - Optional map from skill name to a human-readable
 *   description (from the global skills index). Names missing here fall back to
 *   `fallbackDescription`.
 * @param fallbackDescription - Shown when a skill has no indexed description.
 */
export function buildSkillSlashCommands(
  loadedSkills: readonly string[] | undefined,
  descriptionByName: ReadonlyMap<string, string>,
  fallbackDescription: string,
  additionalSkills: readonly string[] = []
): SlashCommandItem[] {
  const names = mergeLoadedSkillNames(loadedSkills, additionalSkills);
  if (names.length === 0) {
    return [];
  }
  return names.map((name) => ({
    name,
    description: descriptionByName.get(name) ?? fallbackDescription,
    kind: 'template',
    source: 'skill',
    selectionBehavior: 'insert',
  }));
}

/**
 * Merges the slash command groups into a single de-duplicated list. Earlier
 * groups win on name collisions, so the intended priority is:
 * builtin > ACP agent commands > session skills.
 */
export function mergeSlashCommands(
  builtin: readonly SlashCommandItem[],
  acp: readonly SlashCommandItem[],
  skills: readonly SlashCommandItem[]
): SlashCommandItem[] {
  const map = new Map<string, SlashCommandItem>();
  for (const group of [builtin, acp, skills]) {
    for (const command of group) {
      if (!map.has(command.name)) {
        map.set(command.name, command);
      }
    }
  }
  return Array.from(map.values());
}
