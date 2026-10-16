import { expect, it } from 'vitest';
import { creationOperationIds } from '@/common/chat/document/creation/toolResults';
import { creationTurnResults } from '@/renderer/pages/conversation/runtime/Creation/turnResults';

it('extracts native and ACP results, ignores model input, and deduplicates cards across later turns', () => {
  const id = 'c34c4b76-6a73-4e82-9e72-c995175414db';
  const native = { type: 'tool_call', content: { output: JSON.stringify({ creationOperationId: id }) } };
  const acp = {
    type: 'acp_tool_call',
    content: {
      update: {
        content: [{ type: 'content', content: { type: 'text', text: JSON.stringify({ creationOperationId: id }) } }],
      },
    },
  };
  expect(creationOperationIds([native, acp])).toEqual([id]);
  expect(
    creationOperationIds([
      { type: 'text', content: { creationOperationId: id } },
      { type: 'tool_call', content: { args: { creationOperationId: id } } },
      { type: 'acp_tool_call', content: { rawInput: JSON.stringify({ creationOperationId: id }) } },
    ])
  ).toEqual([]);
  expect([
    ...creationTurnResults([
      { id: 'tools', type: 'tool_summary', messages: [native] },
      { id: 'reply', type: 'text' },
      { id: 'user', type: 'text', position: 'right' },
      { id: 'repeat', type: 'tool_summary', messages: [acp] },
    ]),
  ]).toEqual([['reply', [id]]]);
});
