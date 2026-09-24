import { describe, expect, it } from 'vitest';
import { buildFfmpegArgs, createMediaJob, mediaJobIdempotencyKey, transitionMediaJob } from '@/common/chat/document/mediaJob';

describe('media jobs', () => {
  const spec = { kind: 'transcode' as const, sourcePath: 'input.mp4', outputPath: 'output.mp4', startSeconds: 1, endSeconds: 3 };

  it('creates deterministic idempotency keys and starts queued', () => {
    expect(mediaJobIdempotencyKey(spec)).toBe(mediaJobIdempotencyKey({ ...spec }));
    expect(createMediaJob(spec, 'job-1')).toMatchObject({ id: 'job-1', status: 'queued', progress: 0 });
  });

  it('enforces lifecycle transitions and restart from failure', () => {
    let job = createMediaJob(spec, 'job-1');
    job = transitionMediaJob(job, 'running');
    job = transitionMediaJob(job, 'failed', 'ffmpeg failed');
    expect(transitionMediaJob(job, 'queued').status).toBe('queued');
    expect(() => transitionMediaJob(job, 'succeeded')).toThrow('INVALID_MEDIA_JOB_TRANSITION');
  });

  it('builds argv without shell interpolation', () => {
    expect(buildFfmpegArgs(spec)).toEqual([
      '-hide_banner', '-loglevel', 'error', '-y', '-ss', '1', '-i', 'input.mp4', '-t', '2',
      '-vcodec', 'libx264', '-acodec', 'aac', 'output.mp4',
    ]);
  });

  it('rejects missing outputs and inverted ranges', () => {
    expect(() => createMediaJob({ kind: 'transcode', sourcePath: 'in.mp4' })).toThrow();
    expect(() => createMediaJob({ ...spec, startSeconds: 4, endSeconds: 2 })).toThrow();
  });
});
