import { describe, expect, it } from 'vitest';

import type { Assistant } from '@/common/types/agent/assistantTypes';
import { isOpenH3Assistant, shouldEnableAssistantByDefault } from '@/common/types/agent/assistantDefaults';
import { normalizeAssistantDisplayName } from '@/renderer/utils/model/assistantDisplay';
import { isOpenH3NativeAgent } from '@/renderer/utils/model/agentLogo';

describe('OpenH3 branding boundaries', () => {
  it('normalizes legacy product labels without changing AionCore identifiers', () => {
    expect(normalizeAssistantDisplayName('Aion CLI')).toBe('OpenH3 CLI');
    expect(normalizeAssistantDisplayName('AionUi CLI')).toBe('OpenH3 CLI');
    expect(normalizeAssistantDisplayName('AionUi Butler')).toBe('OpenH3 Butler');
    expect(normalizeAssistantDisplayName('AionUi')).toBe('OpenH3');
    expect(normalizeAssistantDisplayName('AionCore')).toBe('AionCore');
  });

  it('recognizes the native OpenH3 agent even when the backend still serves the legacy icon', () => {
    expect(
      isOpenH3NativeAgent({
        id: 'agent-aionrs',
        backend: 'aionrs',
        agent_type: 'aionrs',
        icon: '/api/assets/logos/brand/aion.svg',
      })
    ).toBe(true);
    expect(
      isOpenH3NativeAgent({
        id: 'agent-claude',
        backend: 'claude',
        agent_type: 'acp',
        icon: '/api/assets/logos/brand/claude.svg',
      })
    ).toBe(false);
  });

  it('keeps only OpenH3 enabled in the first-run default policy', () => {
    expect(shouldEnableAssistantByDefault(assistant('bare-aionrs', 'generated', 'aionrs'))).toBe(true);
    expect(shouldEnableAssistantByDefault(assistant('builtin-aionrs-template', 'builtin', 'aionrs'))).toBe(false);
    expect(shouldEnableAssistantByDefault(assistant('builtin-writer', 'builtin', 'claude'))).toBe(false);
    expect(shouldEnableAssistantByDefault(assistant('user-research', 'user', 'gemini'))).toBe(false);
    expect(shouldEnableAssistantByDefault(assistant('user-native', 'user', 'aionrs'))).toBe(false);
    expect(isOpenH3Assistant(assistant('bare-aionrs', 'generated', 'aionrs'))).toBe(true);
    expect(isOpenH3Assistant(assistant('builtin-aionrs-template', 'builtin', 'aionrs'))).toBe(false);
  });
});

function assistant(id: string, source: Assistant['source'], runtimeKey: string): Assistant {
  return {
    id,
    source,
    name: id,
    name_i18n: {},
    description_i18n: {},
    enabled: true,
    sort_order: 0,
    agent_id: `agent-${runtimeKey}`,
    agent: runtimeKey === 'aionrs' ? { type: 'aionrs', source: 'internal' } : { type: 'acp', source: 'builtin' },
    enabled_skills: [],
    custom_skill_names: [],
    disabled_builtin_skills: [],
    context_i18n: {},
    prompts: [],
    prompts_i18n: {},
    models: [],
    agent_status: 'online',
    team_selectable: true,
    deletable: source === 'user',
  };
}
