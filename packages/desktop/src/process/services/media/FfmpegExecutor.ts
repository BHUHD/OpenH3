import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { MediaJobSpec } from '@/common/chat/document/mediaJob';
import { buildFfmpegArgs } from '@/common/chat/document/mediaJob';
import { resolveMediaBinary } from './mediaBinary';

export type FfmpegProgress = { percent?: number; outTimeSeconds?: number };
export type FfmpegExecutorOptions = {
  binary?: string;
  spawnProcess?: (binary: string, args: string[]) => ChildProcessWithoutNullStreams;
};

export function executeFfmpeg(spec: MediaJobSpec, signal: AbortSignal, onProgress?: (progress: FfmpegProgress) => void, options: FfmpegExecutorOptions = {}): Promise<void> {
  const binary = options.binary ?? resolveMediaBinary('ffmpeg');
  const child = (options.spawnProcess ?? ((command, args) => spawn(command, args, { windowsHide: true })))(binary, [...buildFfmpegArgs(spec), '-progress', 'pipe:1']);
  return new Promise((resolve, reject) => {
    let stderr = '';
    const abort = (): void => { child.kill(); reject(new Error('MEDIA_JOB_CANCELLED')); };
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      for (const line of chunk.split(/\r?\n/)) {
        const [key, value] = line.split('=');
        if (key === 'out_time_us' && Number.isFinite(Number(value))) onProgress?.({ outTimeSeconds: Number(value) / 1_000_000 });
        if (key === 'progress' && value === 'end') onProgress?.({ percent: 1 });
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', (error) => { signal.removeEventListener('abort', abort); reject(error); });
    child.once('close', (code) => {
      signal.removeEventListener('abort', abort);
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `FFMPEG_EXIT_${code ?? 'UNKNOWN'}`));
    });
  });
}
