import { describe, expect, it, vi } from 'vitest';
import { mediaJobApi } from '@/common/chat/document/mediaJobApi';

describe('mediaJobApi', () => {
  it('creates a job and preserves the media service boundary', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ id: 'job-1', status: 'queued' }), { status: 201 }));
    await mediaJobApi.create({ kind: 'probe', sourcePath: 'input.mp4' });
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:33002/api/media-jobs');
    fetchMock.mockRestore();
  });

  it('surfaces service errors', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: 'MEDIA_JOB_NOT_FOUND' }), { status: 404 }));
    await expect(mediaJobApi.get('missing')).rejects.toThrow('MEDIA_JOB_NOT_FOUND');
    fetchMock.mockRestore();
  });
});
