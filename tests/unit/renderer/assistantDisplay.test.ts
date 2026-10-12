import { expect, it } from 'vitest';
import { normalizeAssistantDisplayName } from '@/renderer/utils/model/assistantDisplay';

it('normalizes the Chinese legacy Butler label for new conversation display', () => {
  expect(normalizeAssistantDisplayName('AionUI 管家')).toBe('OpenH3 管家');
  expect(normalizeAssistantDisplayName('AionUi管家')).toBe('OpenH3 管家');
});
