import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { executeFfmpeg } from '@/process/services/media/FfmpegExecutor';

function fakeProcess() {
  const child = new EventEmitter() as any;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdout.setEncoding = vi.fn();
  child.stderr.setEncoding = vi.fn();
  child.kill = vi.fn(() => true);
  return child;
}

const spec = { kind: 'transcode' as const, sourcePath: 'in.mp4', outputPath: 'out.mp4' };

describe('ffmpeg executor', () => {
  it('passes argv and reports progress until exit', async () => {
    const child = fakeProcess();
    const progress: unknown[] = [];
    const promise = executeFfmpeg(spec, new AbortController().signal, (value) => progress.push(value), {
      binary: 'ffmpeg-test', spawnProcess: vi.fn(() => child),
    });
    expect((executeFfmpeg as any)).toBeDefined();
    child.stdout.emit('data', 'out_time_us=1000000\nprogress=continue\n');
    child.stdout.emit('data', 'progress=end\n');
    child.emit('close', 0);
    await expect(promise).resolves.toBeUndefined();
    expect(progress).toEqual([{ outTimeSeconds: 1 }, { percent: 1 }]);
  });

  it('rejects non-zero exit and kills on cancellation', async () => {
    const child = fakeProcess();
    const controller = new AbortController();
    const promise = executeFfmpeg(spec, controller.signal, undefined, { spawnProcess: () => child });
    controller.abort();
    await expect(promise).rejects.toThrow('MEDIA_JOB_CANCELLED');
    expect(child.kill).toHaveBeenCalled();
  });
});
