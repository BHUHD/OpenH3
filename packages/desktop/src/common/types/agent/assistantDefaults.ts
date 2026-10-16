import type { Assistant } from './assistantTypes';

/** True only for the generated OpenH3 assistant backed by the native aionrs runtime. */
export function isOpenH3Assistant(assistant: Pick<Assistant, 'source' | 'agent'>): boolean {
  return (
    assistant.source === 'generated' &&
    (assistant.agent?.type === 'aionrs' || assistant.agent?.acp_backend === 'aionrs')
  );
}

/**
 * First-run defaults keep OpenH3 available while preserving user-authored
 * assistants. Official/generated assistants backed by another runtime start
 * disabled and can still be enabled explicitly in Assistant settings.
 */
export function shouldEnableAssistantByDefault(assistant: Pick<Assistant, 'source' | 'agent'>): boolean {
  return isOpenH3Assistant(assistant);
}
