import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { comfyApi } from '@/common/chat/document/creation/comfyApi';

const fetchMock = vi.fn();
const conversationId = 'conv /+';

describe('ComfyUI conversation-scoped client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({}) });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('scopes operation and job reads to the current conversation', async () => {
    await comfyApi.operation('operation /+', conversationId);
    await comfyApi.job('job /+', conversationId);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:33002/api/comfy/operations/operation%20%2F%2B?conversationId=conv%20%2F%2B',
      'http://127.0.0.1:33002/api/comfy/jobs/job%20%2F%2B?conversationId=conv%20%2F%2B',
    ]);
  });

  it('scopes cancellations and authorization in their request bodies', async () => {
    await comfyApi.cancel('operation', conversationId);
    await comfyApi.cancelJob('job', conversationId);
    await comfyApi.authorize('operation', conversationId);
    expect(fetchMock.mock.calls.map(([, options]) => JSON.parse(options.body))).toEqual([
      { conversationId },
      { conversationId },
      { conversationId },
    ]);
    expect(fetchMock.mock.calls.map(([, options]) => options.method)).toEqual(['POST', 'POST', 'POST']);
  });

  it('scopes every artifact preview URL to the current conversation', () => {
    expect(comfyApi.jobArtifactUrl('job /+', 2, conversationId)).toBe(
      'http://127.0.0.1:33002/api/comfy/jobs/job%20%2F%2B/artifacts/2?conversationId=conv%20%2F%2B'
    );
  });
});
