import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveMediaBinary } from '../mediaBinary';

const exec = promisify(execFile);

/** Supply 24fps frames to the native H3 node, which interprets every reference frame at 24fps. */
export async function withComfyReferenceVideo<T>(
  source: string,
  fps: number | undefined,
  signal: AbortSignal,
  consume: (file: string) => Promise<T>
): Promise<T> {
  if (signal.aborted) throw new Error('COMFY_JOB_CANCELLED');
  // A missing probe result is not proof that the source is already 24fps.
  // Normalize conservatively so the native node's frame/time contract remains true.
  if (fps !== undefined && Math.abs(fps - 24) < 0.001) return consume(source);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openh3-reference-'));
  const target = path.join(directory, `${path.parse(source).name}-24fps.mkv`);
  try {
    try {
      // FFV1 preserves decoded pixels; soundtrack packets are copied without re-encoding.
      await exec(
        resolveMediaBinary('ffmpeg'),
        [
          '-v',
          'error',
          '-nostdin',
          '-i',
          source,
          '-map',
          '0:v:0',
          '-map',
          '0:a:0?',
          '-vf',
          'fps=24',
          '-c:v',
          'ffv1',
          '-level',
          '3',
          '-c:a',
          'copy',
          target,
        ],
        { windowsHide: true, signal, timeout: 120_000, maxBuffer: 1024 * 1024 }
      );
    } catch (cause) {
      if (signal.aborted) throw new Error('COMFY_JOB_CANCELLED', { cause });
      throw new Error('COMFY_REFERENCE_VIDEO_NORMALIZATION_FAILED', { cause });
    }
    if (signal.aborted) throw new Error('COMFY_JOB_CANCELLED');
    return await consume(target);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
