import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ComfyGenerationInput, ComfyProfile } from '@/common/chat/document/creation/comfy';
import { resolveMediaBinary } from '../mediaBinary';

export type ComfySmokeContext = { profile: ComfyProfile; input: ComfyGenerationInput };
const exec = promisify(execFile);
function checkAbort(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('COMFY_INSTALL_CANCELLED');
}
function expected(
  context: ComfySmokeContext | undefined,
  key: 'width' | 'height' | 'durationSeconds'
): number | undefined {
  if (!context?.profile.bindings[key]?.length) return undefined;
  const value = Number(context.input[key] ?? context.profile.defaults[key]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/** Decode representative smoke media and check the capabilities exercised by this exact recipe. */
export async function verifyComfySmokeArtifact(
  artifact: { path: string; mimeType: string },
  kind: ComfyProfile['kind'],
  signal: AbortSignal,
  context?: ComfySmokeContext
): Promise<void> {
  checkAbort(signal);
  try {
    const result = await exec(
      resolveMediaBinary('ffprobe'),
      ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', artifact.path],
      { windowsHide: true, signal, timeout: 30_000, maxBuffer: 1024 * 1024 }
    );
    const data = JSON.parse(result.stdout) as {
      streams?: Array<{
        codec_type?: string;
        width?: number;
        height?: number;
        duration?: string;
        avg_frame_rate?: string;
      }>;
      format?: { duration?: string };
    };
    const stream = data.streams?.find(
      (entry) => entry.codec_type === 'video' && Number(entry.width) > 0 && Number(entry.height) > 0
    );
    if (!stream || Number(stream.width) * Number(stream.height) > 268_402_689)
      throw new Error('invalid visual dimensions');
    for (const key of ['width', 'height'] as const) {
      const planned = expected(context, key);
      if (planned && stream[key] !== planned) throw new Error(`unexpected ${key}`);
    }
    const duration = Number(data.format?.duration ?? stream.duration);
    if (kind === 'video') {
      if (!(duration > 0)) throw new Error('no video duration');
      const planned = expected(context, 'durationSeconds');
      const [numerator, denominator] = (stream.avg_frame_rate ?? '').split('/').map(Number);
      const fps = denominator ? numerator / denominator : 0;
      const tolerance = Math.max(0.15, fps > 0 ? 2 / fps : 0.25);
      if (planned && Math.abs(duration - planned) > tolerance) throw new Error('unexpected duration');
    }
    const samples: Buffer[] = [];
    const positions = kind === 'video' ? [duration * 0.1, duration * 0.5, duration * 0.9] : [0];
    for (const position of positions) {
      checkAbort(signal);
      const decoded = await exec(
        resolveMediaBinary('ffmpeg'),
        [
          '-v',
          'error',
          '-xerror',
          ...(kind === 'video' ? ['-ss', String(position)] : []),
          '-i',
          artifact.path,
          '-map',
          '0:v:0',
          '-frames:v',
          '1',
          '-vf',
          'scale=128:128:force_original_aspect_ratio=decrease',
          '-pix_fmt',
          'gray',
          '-f',
          'rawvideo',
          'pipe:1',
        ],
        { windowsHide: true, signal, timeout: 30_000, maxBuffer: 1024 * 1024, encoding: 'buffer' }
      );
      if (!decoded.stdout.length) throw new Error('empty pixels');
      samples.push(decoded.stdout);
    }
    if (!samples.some((sample) => sample.some((pixel) => pixel > 1) && sample.some((pixel) => pixel < 254)))
      throw new Error('blank pixels');
    if (kind === 'video' && samples.every((sample) => sample.equals(samples[0]))) throw new Error('frozen video');
    const requiresAudio = context?.profile.capabilities.some((capability) =>
      ['native-audio', 'audio-video', 'video-with-audio'].includes(capability)
    );
    if (kind === 'video' && requiresAudio) {
      if (!data.streams?.some((entry) => entry.codec_type === 'audio')) throw new Error('missing native audio');
      const decoded = await exec(
        resolveMediaBinary('ffmpeg'),
        [
          '-v',
          'error',
          '-xerror',
          '-i',
          artifact.path,
          '-map',
          '0:a:0',
          '-t',
          String(Math.min(2, duration)),
          '-ac',
          '1',
          '-ar',
          '8000',
          '-f',
          's16le',
          'pipe:1',
        ],
        { windowsHide: true, signal, timeout: 30_000, maxBuffer: 1024 * 1024, encoding: 'buffer' }
      );
      if (!decoded.stdout.length) throw new Error('empty native audio');
    }
    checkAbort(signal);
  } catch (cause) {
    checkAbort(signal);
    const code = (cause as NodeJS.ErrnoException | undefined)?.code;
    if (code && ['ENOENT', 'EACCES', 'EPERM', 'ENOEXEC'].includes(code))
      throw new Error('COMFY_MEDIA_VALIDATOR_UNAVAILABLE', { cause });
    throw new Error(kind === 'image' ? 'COMFY_SMOKE_IMAGE_INVALID' : 'COMFY_SMOKE_VIDEO_INVALID', { cause });
  }
}
